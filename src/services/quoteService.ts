import "server-only";
import {
  bucketOfTick,
  getKstParts,
  getMarketState,
  getTickIndex,
  TICKS_PER_CANDLE,
  ticksPerDay,
} from "@/lib/market";
import { loadMarketConfig } from "@/lib/marketHours";
import { PRICE_LIMIT_RATE } from "@/lib/engine/randomWalk";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  computeIndexQuotes,
  loadIndices,
  loadPrevIndexCloses,
} from "@/services/indexService";
import type { IndexQuote, MarketState, StockQuote, StockSector, StockTier } from "@/types/domain";

export interface QuoteBoard {
  marketState: MarketState;
  asOf: string; // 기준 시각 (ISO)
  haltedUntil: string | null; // 서킷브레이커 해제 시각 (발동 중일 때만)
  market: { openHour: number; closeHour: number; closedWeekdays: number[] }; // 장 운영 안내용
  indices: IndexQuote[]; // 나스피/나스닥 (Phase 8)
  quotes: StockQuote[];
  tickIndex: number | null; // 현재 틱 인덱스 (전체 개장일 규칙으로 계산·클램프, 장외 null) — 차트 라이브 tip용
}

interface CurrentTick {
  stock_code: string;
  price: number;
  is_halted: boolean;
}

// 전 종목의 "현재 틱 1행"만 조회 (42종목 → 42행, 페이지네이션 불필요).
// Task 9 차트와 마찬가지로 시세판도 경로성 데이터(스파크·거래량)는 daily_candles로
// 옮기되, 현재가·정지 여부만큼은 실 틱값 그대로 정확해야 하므로 여기서 단건 조회한다.
async function loadCurrentTicks(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  date: string,
  tickIndex: number
): Promise<CurrentTick[]> {
  const { data, error } = await supabase
    .from("daily_ticks")
    .select("stock_code, price, is_halted")
    .eq("date", date)
    .eq("tick_index", tickIndex);
  if (error) throw error;
  return data;
}

interface DailyCandleRow {
  stock_code: string;
  bucket: number;
  close: number;
  volume: number;
}

// 전 종목 × 하루치 1분 캔들을 페이지네이션으로 로드 (daily_candles, 종목당 최대
// 720행 — 42종목이면 최대 30,240행이라 단일 쿼리는 PostgREST max_rows에 잘린다).
// (stock_code, bucket) 고정 정렬이라 페이지 경계가 안정적이다.
// maxBucketExclusive 지정 시 그 버킷 미만까지만 — Task 9 차트와 동일한 미래유출
// 게이팅(진행 중인 현재 버킷은 daily_candles에 이미 사전 집계돼 있지만 아직
// 완료되지 않았으므로 제외).
async function loadDayCandles(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  date: string,
  maxBucketExclusive?: number
): Promise<DailyCandleRow[]> {
  const PAGE = 1000;
  const rows: DailyCandleRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("daily_candles")
      .select("stock_code, bucket, close, volume")
      .eq("date", date);
    if (maxBucketExclusive !== undefined) query = query.lt("bucket", maxBucketExclusive);
    const { data, error } = await query
      .order("stock_code", { ascending: true })
      .order("bucket", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// 전 종목 현재가 일괄 조회 (T-205)
// - 장중: 현재 틱 인덱스의 사전 생성 가격
// - 장 마감 후: 오늘 종가 (틱 83)
// - 개장 전·휴장일: 직전 개장일 종가 (등락률 0)
export async function getQuoteBoard(now: Date = new Date()): Promise<QuoteBoard> {
  const supabase = getSupabaseAdmin();
  const { hours, rules } = await loadMarketConfig(); // 어드민이 조절하는 장 시간·휴장 규칙
  let state: MarketState = getMarketState(now, hours, rules);
  const { date: today, hour } = getKstParts(now);

  // 서킷브레이커 (어드민 수동 발동, T-405/T-604) — 장중에만 의미 있음
  let haltedUntil: string | null = null;
  if (state === "open") {
    const { data: cb } = await supabase
      .from("config")
      .select("value")
      .eq("key", "circuit_breaker_until")
      .maybeSingle();
    if (cb?.value) {
      const until = new Date(String(cb.value));
      if (until > now) {
        state = "halted";
        haltedUntil = until.toISOString();
      }
    }
  }

  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("code, name, tier, sector, shares_outstanding")
    .eq("listed", true)
    .order("code");
  if (stocksError) throw stocksError;

  // 섹터 한국어 라벨 (sectors 테이블 — 어드민이 관리하는 동적 데이터)
  const { data: sectorRows, error: sectorError } = await supabase
    .from("sectors")
    .select("code, label_ko");
  if (sectorError) throw sectorError;
  const sectorLabels: Record<string, string> = {};
  for (const row of sectorRows) sectorLabels[row.code] = row.label_ko;

  // 직전 개장일 종가 (오늘 이전 가장 최근 요약) — 등락률 기준
  const { data: prevRows, error: prevError } = await supabase
    .from("daily_summary")
    .select("stock_code, date, close")
    .lt("date", today)
    .order("date", { ascending: false });
  if (prevError) throw prevError;
  const prevCloses: Record<string, number> = {};
  for (const row of prevRows) {
    if (!(row.stock_code in prevCloses)) prevCloses[row.stock_code] = row.close;
  }

  // 오늘 이전 요약이 없으면(리허설 기간) 미래의 기준가로 폴백하되,
  // 오늘 자신의 잠정 요약은 제외 (오늘 종가가 미리 새는 것 방지)
  if (Object.keys(prevCloses).length === 0) {
    const { data: earliest, error: earliestError } = await supabase
      .from("daily_summary")
      .select("stock_code, date, close")
      .gt("date", today)
      .order("date", { ascending: true });
    if (earliestError) throw earliestError;
    for (const row of earliest) {
      if (!(row.stock_code in prevCloses)) prevCloses[row.stock_code] = row.close;
    }
  }

  // 현재 참조할 틱 인덱스: 장중이면 현재 틱, 마감 후면 마지막 틱, 그 외 null
  let tickIndex: number | null = null;
  let afterClose = false; // 오늘 장 마감 직후(오늘 버킷 전부 완료) — 차트 서비스와 동일 구분
  if (state === "open" || state === "halted") {
    tickIndex = getTickIndex(now, hours, rules); // CB 중에도 가격은 현재 틱에서 동결 표시
  } else if (state === "closed" && hour >= hours.closeHour) {
    tickIndex = ticksPerDay(hours) - 1; // 오늘 장 마감 직후 → 오늘 종가
    afterClose = true;
  }

  // 오늘 캔들 버킷 노출 상한(미포함, bucket < bucketLimit). 장중이면 진행 중인
  // 현재 버킷은 아직 미완료이므로 제외(bucketOfTick(tickIndex)), 마감 후면 오늘
  // 버킷 전부(totalBuckets) 노출 — Task 9 chartService.getChartData와 동일 원칙.
  const totalBuckets = ticksPerDay(hours) / TICKS_PER_CANDLE;
  let bucketLimit: number | null = null;
  if (tickIndex !== null) {
    bucketLimit = afterClose ? totalBuckets : bucketOfTick(tickIndex);
  }

  const prices: Record<string, { price: number; isHalted: boolean }> = {};
  const sparks: Record<string, number[]> = {};
  const pathByStock: Record<string, Record<number, number>> = {}; // 지수 계산용 (버킷 정렬)
  // 당일 누적 시뮬 시장 거래량 (완료 버킷의 daily_candles.volume 합 — 참가자 체결과 무관)
  const volumes: Record<string, number> = {};
  if (tickIndex !== null) {
    // 현재가는 현재 틱 1행만(42행), 스파크·거래량은 완료 버킷까지의 daily_candles(종목당
    // 최대 720행)만 — 하루 전체 raw 틱(종목당 최대 4,320행) 로드를 피해 응답 시간을
    // 초 단위에서 유지한다.
    const [currentTicks, candleRows] = await Promise.all([
      loadCurrentTicks(supabase, today, tickIndex),
      loadDayCandles(supabase, today, bucketLimit ?? undefined),
    ]);
    for (const row of currentTicks) {
      prices[row.stock_code] = { price: row.price, isHalted: row.is_halted };
    }
    for (const row of candleRows) {
      (sparks[row.stock_code] ??= []).push(row.close);
      (pathByStock[row.stock_code] ??= {})[row.bucket] = row.close;
      volumes[row.stock_code] = (volumes[row.stock_code] ?? 0) + row.volume;
    }
    // 현재가를 스파크 마지막 점으로 이어붙여 라인이 현재까지 자연스럽게 이어지게 한다
    // (버킷 해상도라 완료 버킷 종가까지만 있으면 라인이 현재보다 뒤처져 보인다).
    for (const [code, current] of Object.entries(prices)) {
      (sparks[code] ??= []).push(current.price);
    }
  }

  // 개장 전·휴장일(오늘 틱 없음): 직전 세션 라인을 스파크라인 fallback으로 남긴다.
  // 상세 차트 라인 fallback과 동일 UX. 색·등락률도 그 세션 시가→종가 기준으로
  // 표시해 라인 모양·색·숫자가 모두 같은 기준으로 일치하게 한다.
  const fallbackChange: Record<string, { open: number; close: number }> = {};
  // 지수 fallback용: 직전 세션의 버킷별 가격 경로 + 마지막 버킷
  const fallbackPathByStock: Record<string, Record<number, number>> = {};
  let fallbackMaxBucket: number | null = null;
  if (tickIndex === null) {
    const { data: lastDateRow, error: lastDateError } = await supabase
      .from("daily_ticks")
      .select("date")
      .lt("date", today)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastDateError) throw lastDateError;
    if (lastDateRow?.date) {
      // 과거 세션은 이미 완전히 종료됐으므로 전 버킷을 그대로 노출해도 유출이 아니다.
      const prevCandles = await loadDayCandles(supabase, lastDateRow.date);
      for (const row of prevCandles) {
        (sparks[row.stock_code] ??= []).push(row.close);
        (fallbackPathByStock[row.stock_code] ??= {})[row.bucket] = row.close;
        if (fallbackMaxBucket === null || row.bucket > fallbackMaxBucket) {
          fallbackMaxBucket = row.bucket;
        }
      }
      for (const [code, arr] of Object.entries(sparks)) {
        if (arr.length > 0) {
          fallbackChange[code] = { open: arr[0], close: arr[arr.length - 1] };
        }
      }
    }
  }

  // 시장 지수 (나스피/나스닥)
  const currentPrices: Record<string, number> = {};
  for (const [code, current] of Object.entries(prices)) currentPrices[code] = current.price;
  const [indexRows, prevIndexCloses] = await Promise.all([
    loadIndices(),
    loadPrevIndexCloses(today),
  ]);
  const indices = computeIndexQuotes({
    indices: indexRows,
    members: stocks.map((s) => ({
      code: s.code,
      tier: s.tier as StockTier,
      sharesOutstanding: s.shares_outstanding,
    })),
    prevCloses,
    currentPrices,
    pathByStock,
    bucketLimit,
    prevIndexCloses,
    fallbackPathByStock,
    fallbackMaxBucket,
  });

  const quotes: StockQuote[] = stocks.map((stock) => {
    const prevClose = prevCloses[stock.code] ?? 0;
    const current = prices[stock.code];
    const price = current?.price ?? prevClose;
    // 오늘 틱이 있으면 직전 종가 대비. 없으면(개장 전·휴장) 직전 세션 시가→종가
    // 기준으로 표시해 fallback 스파크라인과 등락 방향·색을 일치시킨다.
    const fb = current ? undefined : fallbackChange[stock.code];
    const change =
      fb && fb.open > 0 ? fb.close - fb.open : prevClose > 0 ? price - prevClose : 0;
    const changeBase = fb && fb.open > 0 ? fb.open : prevClose;
    const upperLimit = prevClose > 0 ? Math.round(prevClose * (1 + PRICE_LIMIT_RATE)) : 0;
    const lowerLimit = prevClose > 0 ? Math.round(prevClose * (1 - PRICE_LIMIT_RATE)) : 0;

    return {
      code: stock.code,
      name: stock.name,
      tier: stock.tier as StockTier,
      sector: stock.sector as StockSector,
      sectorLabel: sectorLabels[stock.sector] ?? stock.sector,
      price,
      prevClose,
      change,
      changePercent: changeBase > 0 ? Math.round((change / changeBase) * 10000) / 100 : 0,
      isHalted: current?.isHalted ?? false,
      // 반올림 오차를 감안해 ±10원 이내면 상·하한 도달로 표시
      isUpperLimit: prevClose > 0 && price >= upperLimit - 10,
      isLowerLimit: prevClose > 0 && price <= lowerLimit + 10,
      upperLimit,
      lowerLimit,
      marketCap: price * stock.shares_outstanding,
      volume: Math.round(volumes[stock.code] ?? 0), // 시뮬 시장 거래량, 표시용 정수 반올림

      spark: sparks[stock.code] ?? [],
    };
  });

  return {
    marketState: state,
    asOf: now.toISOString(),
    haltedUntil,
    market: {
      openHour: hours.openHour,
      closeHour: hours.closeHour,
      closedWeekdays: rules.closedWeekdays ?? [],
    },
    indices,
    quotes,
    tickIndex,
  };
}

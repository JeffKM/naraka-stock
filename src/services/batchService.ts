import "server-only";
import { applySectorEvent, drawDailyBiases, drawSectorEvent, realizeBias } from "@/lib/engine/bias";
import { generateDailyPath, PRICE_LIMIT_RATE } from "@/lib/engine/randomWalk";
import { createRng, hashSeed } from "@/lib/engine/rng";
import {
  generateDisclosures,
  generateEarlySignalNews,
  generateRegularNews,
  generateSectorNews,
  pickEarlySignalTargets,
  type DailyMove,
  type GeneratedNews,
  type StockDayPath,
  type UsedTitles,
} from "@/lib/news/generate";
import {
  addDays,
  getKstParts,
  isOpenDate,
  tickTimestamp,
  ticksPerDay,
  MARKET_CLOSE_HOUR,
  MARKET_OPEN_HOUR,
  type OpenDayRules,
} from "@/lib/market";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { recordIndexCloses } from "@/services/indexService";
import { loadDayLastTicks } from "@/services/tickService";
import type { StockTier } from "@/types/domain";

// 일일 배치 (T-204): 폐장 시각에 실행 (pg_cron이 설정된 폐장 시각으로 트리거)
// 1) 오늘이 개장일이면 정산 (OHLC 확정 + 금요일이면 배당 + 공시 발행)
// 2) 익일이 개장일이면 편향 추첨 → 경로 생성(틱 수는 장 시간에서 파생) → 정식뉴스
//    → 원자 반영
//
// 모든 DB 반영은 apply_daily_batch() 단일 트랜잭션. 재실행에 안전(멱등)하다.

export interface BatchResult {
  today: string;
  settled: boolean;
  dividendsPaid: number;
  tomorrow: string | null;
  ticksInserted: number;
  newsInserted: number;
  biases: Record<string, number>;
}

interface ConfigMap {
  eventStart: string;
  eventEnd: string;
  dividendPercent: number;
  rules: OpenDayRules;
  openHour: number;
  closeHour: number;
  ticksPerDay: number; // 장 시간에서 파생 (12~24시면 144틱)
}

async function loadConfig(): Promise<ConfigMap> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("config").select("key, value");
  if (error) throw error;
  const map = Object.fromEntries(data.map((row) => [row.key, row.value]));
  const openHour = Number(map.market_open_hour ?? MARKET_OPEN_HOUR);
  const closeHour = Number(map.market_close_hour ?? MARKET_CLOSE_HOUR);
  return {
    eventStart: map.event_start,
    eventEnd: map.event_end,
    dividendPercent: Number(map.dividend_percent ?? 1),
    rules: {
      closedWeekdays: map.closed_weekdays ?? undefined,
      holidayExceptions: map.holiday_exceptions ?? [],
      extraOpenDays: map.extra_open_days ?? [],
    },
    openHour,
    closeHour,
    ticksPerDay: ticksPerDay({ openHour, closeHour }),
  };
}

export async function runDailyBatch(overrideToday?: string): Promise<BatchResult> {
  const supabase = getSupabaseAdmin();
  const config = await loadConfig();
  // "방금 닫힌 개장일" = today. 폐장 정각에 배치가 도는데, 폐장이 24:00이면 크론이
  // 다음 날 00:00(KST)에 뜨므로 실행 시각 hour < openHour면 어제가 방금 닫힌 날이다.
  const kst = getKstParts();
  const today = overrideToday ?? (kst.hour < config.openHour ? addDays(kst.date, -1) : kst.date);

  // 이벤트 시작 전에도 배치는 돌게 둔다 (리허설·테스트) — 종료 후에만 중단
  const todayOpen = isOpenDate(today, config.rules) && today <= config.eventEnd;
  const isFriday = new Date(`${today}T12:00:00Z`).getUTCDay() === 5;

  const tomorrowDate = addDays(today, 1);
  const tomorrowOpen = isOpenDate(tomorrowDate, config.rules) && tomorrowDate <= config.eventEnd;

  // 종목 + 직전 종가 (가장 최근 daily_summary)
  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("code, name, tier, sector")
    .eq("listed", true);
  if (stocksError) throw stocksError;

  let biases: Record<string, number> = {};
  const summaries: Array<Record<string, unknown>> = [];
  const ticks: Array<Record<string, unknown>> = [];
  const stockPaths: StockDayPath[] = []; // 정식뉴스 생성용 (익일 경로)
  const news: GeneratedNews[] = [];

  if (tomorrowOpen) {
    // 직전 종가: 오늘 정산분이 아직 DB에 없으므로 "오늘 틱의 마지막 값"을 우선 사용,
    // 오늘이 휴장이었으면 최근 daily_summary 종가를 쓴다.
    const prevCloses = await loadPrevCloses(today, todayOpen, tomorrowDate);

    // 시드: 날짜 + 서버 비밀 → 결정적이지만 외부에서 예측 불가
    const rng = createRng(hashSeed(`${process.env.SESSION_SECRET}|${tomorrowDate}`));
    const biasTargets = stocks.map((s) => ({
      code: s.code,
      tier: s.tier as StockTier,
      sector: s.sector as string,
    }));
    const individualBiases = drawDailyBiases(biasTargets, rng);
    // 섹터 이벤트 (피드백 3): 개별 편향 위에 섹터 공통 편향을 덧댄다. RNG 소비 순서상
    // drawDailyBiases 직후·generateDailyPath 루프 진입 전에 호출해야 시드 재현성이 유지된다.
    // applySectorEvent는 RNG를 소비하지 않는 순수 병합이라 아래 배정은 RNG 스트림에 영향 없다.
    const sectorEvent = drawSectorEvent(biasTargets, rng);
    // 가격 경로·요약·섹터 판정용 결합 편향 (개별 + 섹터 가산). 조기 방향뉴스 후보
    // 선정에는 쓰지 않는다 — 아래 pickEarlySignalTargets 호출부 주석 참고 (리뷰 결함 수정).
    biases = applySectorEvent(individualBiases, biasTargets, sectorEvent);

    for (const stock of stocks) {
      const prevClose = prevCloses[stock.code];
      if (!prevClose) {
        throw new Error(`직전 종가가 없습니다: ${stock.code} (${today})`);
      }
      // 실제 경로는 확률적 실현치(realizeBias)를 따르고, 뉴스도 이 실현 경로를
      // "설명"하는 방식으로 발행된다 (추첨 bias가 아니라 실현 결과 기준 — generate.ts)
      const path = generateDailyPath(
        prevClose,
        realizeBias(biases[stock.code], rng),
        stock.tier as StockTier,
        rng,
        config.ticksPerDay
      );
      summaries.push({
        stock_code: stock.code,
        open: path.open,
        high: path.high,
        low: path.low,
        close: path.close,
        bias: biases[stock.code],
      });
      ticks.push(
        ...path.ticks.map((t) => ({
          stock_code: stock.code,
          tick_index: t.tickIndex,
          price: t.price,
          is_halted: t.isHalted,
        }))
      );
      stockPaths.push({
        code: stock.code,
        prevClose,
        ticks: path.ticks.map((t) => ({ tickIndex: t.tickIndex, price: t.price })),
      });
    }

    // 내일자 정식뉴스 (사전 경로의 실제 움직임을 설명 — 장중 시간차 노출, T-502)
    // 이미 발행한 템플릿은 재사용하지 않는다 (생성 대상일 자신의 뉴스는 재실행 시
    // 교체되므로 이력에서 제외 — 배치 멱등성 유지)
    const usedTitles = await loadUsedHintTitles(tomorrowDate);

    // 장중 조기 방향뉴스 (편향 이벤트 상위 2종을 장 70% 지점에 흘림 — T-505).
    // 이 종목은 후반 정식뉴스에서 제외해 한 종목당 방향뉴스 하나만 유지한다.
    // 후보 선정·세기(magnitude)는 반드시 "개별" 편향(individualBiases) 기준이어야 한다.
    // 결합(섹터 가산 후) 편향을 넘기면 섹터-only 종목이 top-2를 밀어내거나 개별+섹터
    // 상쇄로 순편향이 낮은 종목이 뽑히는 리뷰 결함이 재발한다 (방향 자체는 아래 함수
    // 내부에서 "노출 틱→종가 실제 방향"으로 실현 경로 기준 산출되므로 결합 편향의 영향을
    // 받지 않는다).
    const earlyTargets = pickEarlySignalTargets(individualBiases);
    news.push(
      ...generateEarlySignalNews(
        stockPaths,
        earlyTargets,
        individualBiases,
        tomorrowDate,
        config.openHour,
        rng,
        usedTitles
      )
    );
    news.push(
      ...generateRegularNews(
        stockPaths,
        tomorrowDate,
        config.openHour,
        rng,
        usedTitles,
        1,
        undefined,
        new Set(earlyTargets)
      )
    );

    // 섹터 뉴스 (피드백 3): 섹터 이벤트 발생 시 정식뉴스 1건(stock_code=null) 추가
    news.push(
      ...generateSectorNews(
        sectorEvent ? { sector: sectorEvent.sector, direction: sectorEvent.direction } : null,
        config.ticksPerDay,
        tomorrowDate,
        config.openHour
      )
    );
  }

  // 오늘자 공시 (실제 결과 — 급등락·상하한만). 폐장 직전 틱 시각에 스탬프해
  // 폐장 순간부터 노출된다 (설정된 폐장 시각 기준).
  if (todayOpen) {
    const moves = await loadTodayMoves(today, stocks);
    const disclosureRng = createRng(
      hashSeed(`${process.env.SESSION_SECRET}|disclosure|${today}`)
    );
    const disclosureAt = tickTimestamp(today, config.ticksPerDay - 1, config.openHour);
    news.push(...generateDisclosures(moves, today, disclosureAt, disclosureRng));
  }

  const { data: result, error } = await supabase.rpc("apply_daily_batch", {
    p_today: today,
    p_settle: todayOpen,
    p_pay_dividend: todayOpen && isFriday,
    p_dividend_percent: config.dividendPercent,
    p_tomorrow: tomorrowOpen ? tomorrowDate : null,
    p_summaries: summaries,
    p_ticks: ticks,
    // DB 함수는 snake_case 키를 기대한다
    p_news: news.map((n) => ({
      date: n.date,
      stock_code: n.stockCode,
      grade: n.grade,
      title: n.title,
      body: n.body,
      published_at: n.publishedAt,
    })),
  });
  if (error) throw error;

  // 지수 종가 기록 (마지막 틱 기준, upsert라 재실행 안전) — 정산일에만 의미 있음
  if (todayOpen) {
    await recordIndexCloses(today);
  }

  return {
    today,
    settled: result.settled,
    dividendsPaid: result.dividendsPaid,
    tomorrow: tomorrowOpen ? tomorrowDate : null,
    ticksInserted: result.ticksInserted,
    newsInserted: result.newsInserted,
    biases,
  };
}

// 종목별로 이미 발행에 쓴 힌트 템플릿 제목의 누적 사용 횟수 (순환 추첨용)
// 생성 대상일(targetDate)의 뉴스는 배치 재실행 시 삭제 후 교체되므로 제외한다
async function loadUsedHintTitles(targetDate: string): Promise<UsedTitles> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("news")
    .select("stock_code, title")
    .eq("is_auto", true)
    .in("grade", ["news", "rumor"])
    .neq("date", targetDate)
    .not("stock_code", "is", null);
  if (error) throw error;

  const used: Record<string, Map<string, number>> = {};
  for (const row of data) {
    const code = row.stock_code as string;
    const counts = (used[code] ??= new Map());
    counts.set(row.title, (counts.get(row.title) ?? 0) + 1);
  }
  return used;
}

// 오늘의 실제 등락 (공시 생성용): 종가(마지막 틱) vs 직전 개장일 종가
async function loadTodayMoves(
  today: string,
  stocks: Array<{ code: string; name: string }>
): Promise<DailyMove[]> {
  const supabase = getSupabaseAdmin();

  const lastTicks = await loadDayLastTicks(today);
  if (Object.keys(lastTicks).length === 0) return []; // 오늘 틱 없음 (리허설 첫날 등)

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

  const todayCloses = Object.fromEntries(
    Object.entries(lastTicks).map(([code, t]) => [code, t.price])
  );

  return stocks.flatMap((stock) => {
    const close = todayCloses[stock.code];
    const prev = prevCloses[stock.code];
    if (!close || !prev) return [];
    const changePercent = Math.round(((close - prev) / prev) * 1000) / 10;
    return [
      {
        code: stock.code,
        name: stock.name,
        changePercent,
        isLimitUp: close >= Math.round(prev * (1 + PRICE_LIMIT_RATE)) - 10,
        isLimitDown: close <= Math.round(prev * (1 - PRICE_LIMIT_RATE)) + 10,
      },
    ];
  });
}

// 종목별 직전 종가 로드
// 주의: 생성 대상일(tomorrow)의 기존 잠정 요약은 절대 기준가로 쓰면 안 된다
// (배치 재실행 시 자기 자신의 이전 결과를 기준가로 삼는 오염 → 멱등성 깨짐)
async function loadPrevCloses(
  today: string,
  todayOpen: boolean,
  tomorrow: string
): Promise<Record<string, number>> {
  const supabase = getSupabaseAdmin();

  if (todayOpen) {
    // 오늘 개장일: 오늘 경로의 마지막 틱이 오늘 종가
    const lastTicks = await loadDayLastTicks(today);
    if (Object.keys(lastTicks).length > 0) {
      return Object.fromEntries(
        Object.entries(lastTicks).map(([code, t]) => [code, t.price])
      );
    }
    // 오늘 틱이 없으면(개장 첫날 전 리허설 등) 최근 요약으로 폴백
  }

  // 최근 daily_summary 종가 (오늘 이하 가장 최근 날짜)
  const { data, error } = await supabase
    .from("daily_summary")
    .select("stock_code, date, close")
    .lte("date", today)
    .order("date", { ascending: false });
  if (error) throw error;

  const closes: Record<string, number> = {};
  for (const row of data) {
    if (!(row.stock_code in closes)) closes[row.stock_code] = row.close;
  }
  if (Object.keys(closes).length > 0) return closes;

  // 오늘 이하 요약이 전혀 없으면(시드 기준가가 미래 날짜인 리허설 기간)
  // 가장 이른 요약으로 폴백하되, 생성 대상일(tomorrow) 자신의 잠정 요약은 제외
  const { data: earliest, error: earliestError } = await supabase
    .from("daily_summary")
    .select("stock_code, date, close")
    .neq("date", tomorrow)
    .gt("date", today)
    .order("date", { ascending: true });
  if (earliestError) throw earliestError;
  for (const row of earliest) {
    if (!(row.stock_code in closes)) closes[row.stock_code] = row.close;
  }
  return closes;
}

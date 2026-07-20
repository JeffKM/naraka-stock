import "server-only";
import { applySectorEvents, drawDailyBiases, drawSectorEvents, realizeBias } from "@/lib/engine/bias";
import { generateDailyPath, generateHeadfakePath, PRICE_LIMIT_RATE } from "@/lib/engine/randomWalk";
import { createRng, hashSeed } from "@/lib/engine/rng";
import {
  generateDisclosures,
  generateRegularNews,
  generateSectorRumors,
  generateStockEarlyNews,
  pickStockNewsTargets,
  type DailyMove,
  type GeneratedNews,
  type StockDayPath,
  type UsedTitles,
} from "@/lib/news/generate";
import {
  addDays,
  getKstParts,
  isOpenDate,
  isoWeekdayOfDate,
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
  // .order("code")로 행 순서를 고정한다: drawDailyBiases·drawSectorEvents가 이 배열
  // 순서로 RNG를 소비하므로(같은 시드라도 순서가 흔들리면 배정이 바뀐다), ORDER BY 없이
  // Postgres 기본 반환 순서에 기대면 안 된다. scripts/simulate.ts의 STOCKS 배열도
  // 동일하게 code 오름차순으로 정렬해 두 경로의 RNG 소비 순서를 맞춘다(quoteService·
  // adminService.listStocks도 이미 code 정렬 — 이 관례와 일치).
  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("code, name, tier, sector")
    .eq("listed", true)
    .order("code");
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
    // 섹터 이벤트 (참여확률 모델, Plan 3): 서로 다른 섹터 0~3개를 뽑고 구성원 각자
    // 70% 확률로 참여시킨다. RNG 소비 순서상 drawDailyBiases 직후·경로 생성 루프
    // 진입 전에 호출해야 시드 재현성이 유지된다. applySectorEvents는 참여 판정으로
    // RNG를 소비하므로(구 단수 버전과 달리 순수 병합이 아님) 이 순서가 중요하다.
    const sectorEvents = drawSectorEvents(biasTargets, rng);
    // 가격 경로·요약·섹터 판정용 결합 편향(개별 + 섹터 참여분). 종목 초반 톤뉴스 후보
    // 선정에는 쓰지 않는다(개별 편향 기준) — 아래 stockNewsTargets 주석 참고.
    biases = applySectorEvents(individualBiases, biasTargets, sectorEvents, rng);

    // 종목 초반 톤뉴스 채널 대상 선정 (Phase 3a·3b) — 반드시 "개별" 편향 기준(결합 편향을 넘기면
    // 섹터-only 종목이 끼거나 개별+섹터 상쇄로 순편향 낮은 종목이 뽑히는 리뷰 결함 재발). 헤드페이크
    // (Phase 3b)는 가격 경로 자체를 펌프-덤프로 바꾸므로 반드시 경로 루프 前에 선정해야 한다. 여기서
    // RNG를 소비(헤드페이크·필러 추출)하므로 이후 경로·뉴스 시드가 이 지점 기준으로 재현된다
    // (이벤트 미개장이라 시장 구성 변화는 허용). generateStockEarlyNews가 이 타겟을 그대로 재사용.
    const stockNewsTargets = pickStockNewsTargets(individualBiases, rng);
    const headfakeSet = new Set(stockNewsTargets.headfakes);

    for (const stock of stocks) {
      const prevClose = prevCloses[stock.code];
      if (!prevClose) {
        throw new Error(`직전 종가가 없습니다: ${stock.code} (${today})`);
      }
      // 헤드페이크(Phase 3b) 종목은 펌프-덤프 경로, 나머지는 실현 편향 기반 랜덤워크.
      // 실제 경로는 확률적 실현치(realizeBias)를 따르고, 뉴스도 이 실현 경로를 "설명"하는
      // 방식으로 발행된다 (추첨 bias가 아니라 실현 결과 기준 — generate.ts).
      const path = headfakeSet.has(stock.code)
        ? generateHeadfakePath(prevClose, stock.tier as StockTier, rng, config.ticksPerDay)
        : generateDailyPath(
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
        volume: path.ticks.reduce((sum, t) => sum + t.volume, 0),
      });
      ticks.push(
        ...path.ticks.map((t) => ({
          stock_code: stock.code,
          tick_index: t.tickIndex,
          price: t.price,
          is_halted: t.isHalted,
          volume: t.volume,
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

    // 종목 초반 톤뉴스 발행 (Phase 3a·3b — 경로 루프 前에 선정한 stockNewsTargets 재사용,
    // generate.ts 상단 참고). 진짜·헤드페이크·필러 모두 후반 정식뉴스에서 제외해 한 종목당
    // 뉴스 하나만 유지한다.
    news.push(
      ...generateStockEarlyNews(
        stockPaths,
        stockNewsTargets,
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
        new Set([
          ...stockNewsTargets.reals,
          ...stockNewsTargets.fillers,
          ...stockNewsTargets.headfakes,
        ])
      )
    );

    // 섹터 찌라시 (v2): 진짜 이벤트 방향을 초반에 예고 + 이벤트 없는 섹터의 가짜 소문.
    // 실현 결과가 아니라 이벤트 의도 방향을 예고하므로 평균 등락 계산이 불필요하다.
    // RNG 소비는 경로 생성이 모두 끝난 뒤라 시세엔 무관하지만, simulate와 동일 지점에서 호출한다.
    const allSectors = Array.from(new Set(biasTargets.map((t) => t.sector)));
    news.push(
      ...generateSectorRumors(
        sectorEvents,
        allSectors,
        config.ticksPerDay,
        tomorrowDate,
        config.openHour,
        rng
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
    // 틱 삽입은 apply_daily_batch에서 분리했다(아래 참고) — 항상 빈 배열을 넘긴다.
    p_ticks: [],
    // DB 함수는 snake_case 키를 기대한다
    p_news: news.map((n) => ({
      date: n.date,
      stock_code: n.stockCode,
      grade: n.grade,
      title: n.title,
      body: n.body,
      source: n.source ?? null,
      published_at: n.publishedAt,
    })),
  });
  if (error) throw error;

  // 익일 틱 청크 삽입 (10초 틱 전환 실측 대응, T-6): 42종목 × 4,320틱 ≈ 181,440개
  // 객체를 apply_daily_batch 안에서 한 번에 넣으면 PostgREST 연결(authenticator)의
  // statement_timeout=8s에 걸려 트랜잭션 전체가 실패한다(로컬 실측 확인). 삭제는
  // apply_daily_batch가 이미 수행했으니(멱등성 유지), 여기서는 순수 삽입만 청크
  // 단위로 나눠 순차 호출한다. 청크당 실제 소요를 8s 한도 대비 넉넉히 아래로 두기
  // 위해 종목 3개(약 12,960틱)씩 묶는다.
  let ticksInserted = 0;
  if (tomorrowOpen && ticks.length > 0) {
    const CHUNK_SIZE = 3 * config.ticksPerDay;
    for (let i = 0; i < ticks.length; i += CHUNK_SIZE) {
      const chunk = ticks.slice(i, i + CHUNK_SIZE);
      const { data: inserted, error: chunkError } = await supabase.rpc(
        "insert_daily_ticks_chunk",
        { p_date: tomorrowDate, p_ticks: chunk }
      );
      if (chunkError) throw chunkError;
      ticksInserted += inserted ?? 0;
    }

    // 익일 1분 캔들 사전 집계 (Task 5의 build_daily_candles, T-7): 반드시 위 청크
    // 삽입 루프가 "끝난 뒤"에 호출해야 한다 — daily_ticks가 아직 비어 있는 시점에
    // 돌리면 빈 캔들만 upsert되고 재호출 전까지 그대로 남는다. 종목별 upsert라
    // 재실행에 안전(멱등)하며, 한 종목 실패가 나머지 종목 집계를 막지 않도록 에러를
    // 모아뒀다가 전체 루프가 끝난 뒤 한 번에 던진다.
    const candleErrors: string[] = [];
    for (const stock of stocks) {
      const { error: candleError } = await supabase.rpc("build_daily_candles", {
        p_stock_code: stock.code,
        p_date: tomorrowDate,
      });
      if (candleError) candleErrors.push(`${stock.code}: ${candleError.message}`);
    }
    if (candleErrors.length > 0) {
      throw new Error(`캔들 집계 실패: ${candleErrors.join("; ")}`);
    }
  }

  // 오래된 raw 10초틱 프루닝 (Task 16): 캔들 집계가 끝난 뒤 실행해야 집계 대상이
  // 먼저 daily_candles로 옮겨진 상태를 보장한다. 부수 작업이라 실패해도 배치
  // 정산 전체를 막지 않고 로깅만 한다(orderService의 lazy 정산 에러 패턴과 동일).
  const { error: pruneError } = await supabase.rpc("prune_old_ticks", { p_keep_days: 3 });
  if (pruneError) console.error("오래된 틱 프루닝 실패(무시):", pruneError.message);

  // 지수 종가 기록 (마지막 틱 기준, upsert라 재실행 안전) — 정산일에만 의미 있음
  if (todayOpen) {
    await recordIndexCloses(today);

    // 주간 배지: 매 개장일 총자산 스냅샷 → 그 주 마지막 개장일이면 정산
    await supabase.rpc("snapshot_user_assets", { p_date: today });
    if (
      today >= config.eventStart &&
      today <= config.eventEnd &&
      isLastOpenDayOfWeek(today, config.rules)
    ) {
      const monday = mondayOf(today);
      const weekStart = monday < config.eventStart ? config.eventStart : monday;
      const { error: settleError } = await supabase.rpc("settle_weekly_badges", {
        p_week_start: weekStart,
        p_week_end: today,
      });
      if (settleError) throw settleError;
    }
  }

  return {
    today,
    settled: result.settled,
    dividendsPaid: result.dividendsPaid,
    tomorrow: tomorrowOpen ? tomorrowDate : null,
    ticksInserted, // 청크 RPC 응답 합산 (apply_daily_batch의 ticksInserted는 항상 0)
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

// 그 날짜가 속한 달력 주(월~일)의 월요일 날짜
function mondayOf(dateStr: string): string {
  return addDays(dateStr, -(isoWeekdayOfDate(dateStr) - 1));
}

// today가 이 주(월~일)의 마지막 개장일인가: 오늘 이후~그 주 일요일까지 개장일이 없으면 true
function isLastOpenDayOfWeek(today: string, rules: OpenDayRules): boolean {
  const sunday = addDays(mondayOf(today), 6);
  let d = addDays(today, 1);
  while (d <= sunday) {
    if (isOpenDate(d, rules)) return false;
    d = addDays(d, 1);
  }
  return true;
}

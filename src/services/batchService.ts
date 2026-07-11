import "server-only";
import { drawDailyBiases, realizeBias } from "@/lib/engine/bias";
import { generateDailyPath } from "@/lib/engine/randomWalk";
import { createRng, hashSeed } from "@/lib/engine/rng";
import { addDays, getKstParts, isOpenDate, type OpenDayRules } from "@/lib/market";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { StockTier } from "@/types/domain";

// 일일 배치 (T-204): 매일 22:00 실행
// 1) 오늘이 개장일이면 정산 (OHLC 확정 + 금요일이면 배당)
// 2) 익일이 개장일이면 편향 추첨 → 84틱 경로 생성 → 원자 반영
//
// 모든 DB 반영은 apply_daily_batch() 단일 트랜잭션. 재실행에 안전(멱등)하다.

export interface BatchResult {
  today: string;
  settled: boolean;
  dividendsPaid: number;
  tomorrow: string | null;
  ticksInserted: number;
  biases: Record<string, number>;
}

interface ConfigMap {
  eventStart: string;
  eventEnd: string;
  dividendPercent: number;
  rules: OpenDayRules;
}

async function loadConfig(): Promise<ConfigMap> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("config").select("key, value");
  if (error) throw error;
  const map = Object.fromEntries(data.map((row) => [row.key, row.value]));
  return {
    eventStart: map.event_start,
    eventEnd: map.event_end,
    dividendPercent: Number(map.dividend_percent ?? 1),
    rules: {
      holidayExceptions: map.holiday_exceptions ?? [],
      extraOpenDays: map.extra_open_days ?? [],
    },
  };
}

export async function runDailyBatch(overrideToday?: string): Promise<BatchResult> {
  const supabase = getSupabaseAdmin();
  const config = await loadConfig();
  const today = overrideToday ?? getKstParts().date;

  // 이벤트 시작 전에도 배치는 돌게 둔다 (리허설·테스트) — 종료 후에만 중단
  const todayOpen = isOpenDate(today, config.rules) && today <= config.eventEnd;
  const isFriday = new Date(`${today}T12:00:00Z`).getUTCDay() === 5;

  const tomorrowDate = addDays(today, 1);
  const tomorrowOpen = isOpenDate(tomorrowDate, config.rules) && tomorrowDate <= config.eventEnd;

  // 종목 + 직전 종가 (가장 최근 daily_summary)
  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("code, tier")
    .eq("listed", true);
  if (stocksError) throw stocksError;

  let biases: Record<string, number> = {};
  const summaries: Array<Record<string, unknown>> = [];
  const ticks: Array<Record<string, unknown>> = [];

  if (tomorrowOpen) {
    // 직전 종가: 오늘 정산분이 아직 DB에 없으므로 "오늘 틱의 마지막 값"을 우선 사용,
    // 오늘이 휴장이었으면 최근 daily_summary 종가를 쓴다.
    const prevCloses = await loadPrevCloses(today, todayOpen, tomorrowDate);

    // 시드: 날짜 + 서버 비밀 → 결정적이지만 외부에서 예측 불가
    const rng = createRng(hashSeed(`${process.env.SESSION_SECRET}|${tomorrowDate}`));
    biases = drawDailyBiases(
      stocks.map((s) => ({ code: s.code, tier: s.tier as StockTier })),
      rng
    );

    for (const stock of stocks) {
      const prevClose = prevCloses[stock.code];
      if (!prevClose) {
        throw new Error(`직전 종가가 없습니다: ${stock.code} (${today})`);
      }
      // 뉴스는 추첨 bias 기준으로 발행하되, 실제 경로는 확률적 실현치를 따른다
      const path = generateDailyPath(
        prevClose,
        realizeBias(biases[stock.code], rng),
        stock.tier as StockTier,
        rng
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
    }
  }

  const { data: result, error } = await supabase.rpc("apply_daily_batch", {
    p_today: today,
    p_settle: todayOpen,
    p_pay_dividend: todayOpen && isFriday,
    p_dividend_percent: config.dividendPercent,
    p_tomorrow: tomorrowOpen ? tomorrowDate : null,
    p_summaries: summaries,
    p_ticks: ticks,
  });
  if (error) throw error;

  return {
    today,
    settled: result.settled,
    dividendsPaid: result.dividendsPaid,
    tomorrow: tomorrowOpen ? tomorrowDate : null,
    ticksInserted: result.ticksInserted,
    biases,
  };
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
    const { data, error } = await supabase
      .from("daily_ticks")
      .select("stock_code, price")
      .eq("date", today)
      .eq("tick_index", 83);
    if (error) throw error;
    if (data.length > 0) {
      return Object.fromEntries(data.map((r) => [r.stock_code, r.price]));
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

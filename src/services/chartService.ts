import "server-only";
import { getKstParts, getTickIndex, ticksPerDay } from "@/lib/market";
import { loadMarketConfig } from "@/lib/marketHours";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// 차트 데이터 (T-402)
//
// 유출 방지가 핵심: 가격 경로는 사전 생성이므로
// - 미래 날짜의 잠정 요약(익일 경로)은 절대 내보내지 않는다
// - 오늘 요약(잠정 종가 포함)은 장 마감(22시) 후에만 내보낸다
// - 오늘 틱은 현재 틱 인덱스까지만 내보낸다

export interface DailyCandle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface IntradayPoint {
  time: number; // Unix epoch (초)
  price: number;
}

export interface ChartData {
  daily: DailyCandle[];
  today: IntradayPoint[];
}

// KST 게임 날짜 + 틱 인덱스 → 차트용 epoch 초 (개장 시각 기준, 5분 간격)
// lightweight-charts는 타임스탬프를 UTC 벽시계로 렌더링하므로 +9h 보정해
// 화면에 KST 시각이 그대로 보이게 한다.
function tickTimeEpoch(date: string, tickIndex: number, openHour: number): number {
  const open = String(openHour).padStart(2, "0");
  const base = new Date(`${date}T${open}:00:00+09:00`).getTime();
  return Math.floor(base / 1000) + tickIndex * 300 + 9 * 3600;
}

export async function getChartData(stockCode: string, now: Date = new Date()): Promise<ChartData> {
  const supabase = getSupabaseAdmin();
  const { hours, rules } = await loadMarketConfig();
  const { date: today, hour } = getKstParts(now);
  const afterClose = hour >= hours.closeHour;

  // 일봉: 과거 확정분 (+ 마감 후엔 오늘 포함)
  const { data: dailyRows, error: dailyError } = await supabase
    .from("daily_summary")
    .select("date, open, high, low, close")
    .lte("date", afterClose ? today : addDaysStr(today, -1))
    .order("date", { ascending: true });
  if (dailyError) throw dailyError;

  // 당일 5분 라인: 현재 틱까지만
  let maxTick: number | null = null;
  if (afterClose) {
    maxTick = ticksPerDay(hours) - 1;
  } else {
    maxTick = getTickIndex(now, hours, rules); // 장중이면 현재 틱, 그 외 null
  }

  let todayPoints: IntradayPoint[] = [];
  if (maxTick !== null) {
    const { data: tickRows, error: tickError } = await supabase
      .from("daily_ticks")
      .select("tick_index, price")
      .eq("stock_code", stockCode)
      .eq("date", today)
      .lte("tick_index", maxTick)
      .order("tick_index", { ascending: true });
    if (tickError) throw tickError;
    todayPoints = tickRows.map((t) => ({
      time: tickTimeEpoch(today, t.tick_index, hours.openHour),
      price: t.price,
    }));
  }

  return {
    daily: dailyRows
      .filter((d) => d.date <= today)
      .map((d) => ({ time: d.date, open: d.open, high: d.high, low: d.low, close: d.close })),
    today: todayPoints,
  };
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

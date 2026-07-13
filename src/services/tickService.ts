import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// 특정 날짜의 종목별 마지막 틱 = 그날 종가.
// 하루 틱 수가 장 시간에 따라 가변(84/120/...)이므로 "틱 83" 같은 고정
// 인덱스 대신 항상 마지막 틱을 조회한다 — 장 시간이 운영 중 바뀌어도 안전.
export interface LastTick {
  tickIndex: number;
  price: number;
}

export async function loadDayLastTicks(date: string): Promise<Record<string, LastTick>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("daily_ticks")
    .select("stock_code, tick_index, price")
    .eq("date", date)
    .order("tick_index", { ascending: true });
  if (error) throw error;

  const last: Record<string, LastTick> = {};
  for (const row of data) {
    last[row.stock_code] = { tickIndex: row.tick_index, price: row.price };
  }
  return last;
}

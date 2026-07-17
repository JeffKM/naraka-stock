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
  // PostgREST max_rows(로컬 config.toml=1000) 상한 대응: 전 종목 × 전 틱은
  // 1000행을 넘어(42종목 × 144틱 = 6048행) 단일 쿼리로는 잘린다. 잘리면 각 종목의
  // 마지막 틱이 실제 종가가 아니라 장중 이른 틱이 되어 종가가 오염되므로 range로
  // 페이지네이션한다. (stock_code, tick_index) 정렬이라 페이지 경계가 종목 중간에
  // 걸려도 다음 페이지에서 더 큰 tick_index가 이어서 덮어써 최종값이 정확하다.
  // (quoteService.loadSessionTicks와 동일 패턴)
  const PAGE = 1000;
  const last: Record<string, LastTick> = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("daily_ticks")
      .select("stock_code, tick_index, price")
      .eq("date", date)
      .order("stock_code", { ascending: true })
      .order("tick_index", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data) {
      last[row.stock_code] = { tickIndex: row.tick_index, price: row.price };
    }
    if (data.length < PAGE) break;
  }
  return last;
}

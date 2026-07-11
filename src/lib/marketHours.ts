import "server-only";
import { DEFAULT_MARKET_HOURS, type MarketHours } from "@/lib/market";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// config의 장 시간 로드 (market_open_hour / market_close_hour)
// 임시 연장·특별 개장 시 config만 바꾸면 서버 전체(시세·차트·체결)가 따라온다.
export async function loadMarketHours(): Promise<MarketHours> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("config")
    .select("key, value")
    .in("key", ["market_open_hour", "market_close_hour"]);
  if (error || !data) return DEFAULT_MARKET_HOURS;

  const map = Object.fromEntries(data.map((row) => [row.key, Number(row.value)]));
  return {
    openHour: map.market_open_hour ?? DEFAULT_MARKET_HOURS.openHour,
    closeHour: map.market_close_hour ?? DEFAULT_MARKET_HOURS.closeHour,
  };
}

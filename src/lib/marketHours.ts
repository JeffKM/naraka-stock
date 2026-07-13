import "server-only";
import {
  CLOSED_WEEKDAYS,
  DEFAULT_MARKET_HOURS,
  type MarketHours,
  type OpenDayRules,
} from "@/lib/market";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export interface MarketConfig {
  hours: MarketHours;
  rules: OpenDayRules;
}

// config의 장 운영 설정 로드 (어드민이 콘솔에서 조절)
// - market_open_hour / market_close_hour: 장 시간 (틱 수도 여기서 파생)
// - closed_weekdays: 정기 휴장 요일 / holiday_exceptions·extra_open_days: 예외일
export async function loadMarketConfig(): Promise<MarketConfig> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("config")
    .select("key, value")
    .in("key", [
      "market_open_hour",
      "market_close_hour",
      "closed_weekdays",
      "holiday_exceptions",
      "extra_open_days",
    ]);
  if (error || !data) {
    return { hours: DEFAULT_MARKET_HOURS, rules: { closedWeekdays: CLOSED_WEEKDAYS } };
  }

  const map = Object.fromEntries(data.map((row) => [row.key, row.value]));
  return {
    hours: {
      openHour: Number(map.market_open_hour ?? DEFAULT_MARKET_HOURS.openHour),
      closeHour: Number(map.market_close_hour ?? DEFAULT_MARKET_HOURS.closeHour),
    },
    rules: {
      closedWeekdays: map.closed_weekdays ?? CLOSED_WEEKDAYS,
      holidayExceptions: map.holiday_exceptions ?? [],
      extraOpenDays: map.extra_open_days ?? [],
    },
  };
}

// 하위 호환: 장 시간만 필요한 곳용
export async function loadMarketHours(): Promise<MarketHours> {
  return (await loadMarketConfig()).hours;
}

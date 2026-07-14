import "server-only";
import {
  CLOSED_WEEKDAYS,
  DEFAULT_MARKET_HOURS,
  getKstParts,
  type MarketHours,
  type OpenDayRules,
} from "@/lib/market";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// 당일 1회 장 시간 오버라이드 — 자정 폐장 후 ~ 당일 개장 전에만 어드민이 설정.
// 저장된 날짜가 오늘(KST)일 때만 유효하고, 날짜가 지나면 자동 무시된다.
export interface MarketHoursOverride extends MarketHours {
  date: string; // 적용 날짜 (YYYY-MM-DD, KST)
}

export interface MarketConfig {
  hours: MarketHours; // 오늘 유효 장 시간 (당일 오버라이드 반영)
  defaultHours: MarketHours; // 전역 기본 장 시간 (콘솔 "장 운영 설정" 값)
  todayOverride: MarketHoursOverride | null; // 오늘 날짜와 일치할 때만 non-null
  rules: OpenDayRules;
}

// config의 장 운영 설정 로드 (어드민이 콘솔에서 조절)
// - market_open_hour / market_close_hour: 기본 장 시간 (틱 수도 여기서 파생)
// - market_hours_override: 오늘 하루만 다른 장 시간 ({date, openHour, closeHour})
// - closed_weekdays: 정기 휴장 요일 / holiday_exceptions·extra_open_days: 예외일
// config 값을 정수 시각으로 안전 변환 — 없거나 NaN이면 fallback 사용.
function toHour(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function loadMarketConfig(): Promise<MarketConfig> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("config")
    .select("key, value")
    .in("key", [
      "market_open_hour",
      "market_close_hour",
      "market_hours_override",
      "closed_weekdays",
      "holiday_exceptions",
      "extra_open_days",
    ]);
  if (error || !data) {
    // config를 못 읽으면 운영 기본값(DEFAULT_MARKET_HOURS = 12~24)으로 안전하게
    // 폴백한다. 조용히 삼키면 장중에 차트가 빈 채로 뜨는 원인을 못 찾으니 로깅.
    console.error("[marketHours] config 로드 실패 — 운영 기본값으로 폴백", error);
    return {
      hours: DEFAULT_MARKET_HOURS,
      defaultHours: DEFAULT_MARKET_HOURS,
      todayOverride: null,
      rules: { closedWeekdays: CLOSED_WEEKDAYS },
    };
  }

  const map = Object.fromEntries(data.map((row) => [row.key, row.value]));
  // 값이 없거나 숫자로 파싱 안 되면(NaN) 운영 기본값으로 폴백 — 깨진 config가
  // 장중을 "휴장"으로 잘못 판정하지 않게 한다.
  const defaultHours: MarketHours = {
    openHour: toHour(map.market_open_hour, DEFAULT_MARKET_HOURS.openHour),
    closeHour: toHour(map.market_close_hour, DEFAULT_MARKET_HOURS.closeHour),
  };

  const raw = map.market_hours_override as Partial<MarketHoursOverride> | undefined;
  const todayOverride: MarketHoursOverride | null =
    raw && raw.date === getKstParts().date
      ? {
          date: raw.date,
          openHour: toHour(raw.openHour, defaultHours.openHour),
          closeHour: toHour(raw.closeHour, defaultHours.closeHour),
        }
      : null;

  return {
    hours: todayOverride
      ? { openHour: todayOverride.openHour, closeHour: todayOverride.closeHour }
      : defaultHours,
    defaultHours,
    todayOverride,
    rules: {
      closedWeekdays: map.closed_weekdays ?? CLOSED_WEEKDAYS,
      holidayExceptions: map.holiday_exceptions ?? [],
      extraOpenDays: map.extra_open_days ?? [],
    },
  };
}

// 하위 호환: 장 시간만 필요한 곳용 (오늘 유효값)
export async function loadMarketHours(): Promise<MarketHours> {
  return (await loadMarketConfig()).hours;
}

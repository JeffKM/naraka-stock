// 장 운영 시간·틱 계산 유틸 (KST 기준 순수 함수)
//
// 기본 규칙 (PRD §2 초안: 수~일 15:00~22:00)에서 출발하되, 실제 운영값은
// 전부 DB config(market_open_hour / market_close_hour / closed_weekdays /
// holiday_exceptions / extra_open_days)로 어드민이 조절한다.
// 하루 틱 수도 장 시간에서 파생된다 — ticksPerDay(hours).

import type { MarketState } from "@/types/domain";

export const MARKET_OPEN_HOUR = 15;
export const MARKET_CLOSE_HOUR = 22;
export const TICK_INTERVAL_MINUTES = 5;
export const TICKS_PER_DAY = 84; // 기본 장 시간 기준 — 엔진 밸런스의 기준 틱 수
export const CLOSED_WEEKDAYS = [1, 2]; // 기본값 (config.closed_weekdays로 오버라이드)

export const CURRENCY_LABEL = "원"; // 화폐 명칭 (사장님 확정 2026-07-11)

interface KstParts {
  date: string; // YYYY-MM-DD
  isoWeekday: number; // 1(월) ~ 7(일)
  hour: number;
  minute: number;
}

// 실행 환경 타임존과 무관하게 KST 기준 날짜·시각을 얻는다.
export function getKstParts(now: Date = new Date()): KstParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value])
  );
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    isoWeekday: weekdayMap[parts.weekday],
    // Intl은 자정을 "24"로 줄 수 있어 보정한다
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

// 장 시간 (config로 오버라이드 가능 — 임시 연장·특별 개장 대응)
export interface MarketHours {
  openHour: number;
  closeHour: number;
}

export const DEFAULT_MARKET_HOURS: MarketHours = {
  openHour: MARKET_OPEN_HOUR,
  closeHour: MARKET_CLOSE_HOUR,
};

// 장 시간 기준 하루 틱 수 (12~22시면 120틱)
export function ticksPerDay(hours: MarketHours = DEFAULT_MARKET_HOURS): number {
  return ((hours.closeHour - hours.openHour) * 60) / TICK_INTERVAL_MINUTES;
}

// 개장일 여부 (요일 규칙 + 예외일)
export function isOpenDay(now: Date = new Date(), rules: OpenDayRules = {}): boolean {
  return isOpenDate(getKstParts(now).date, rules);
}

// 현재 장 상태 (서킷브레이커는 DB 상태라 여기서 판정하지 않는다)
export function getMarketState(
  now: Date = new Date(),
  hours: MarketHours = DEFAULT_MARKET_HOURS,
  rules: OpenDayRules = {}
): Exclude<MarketState, "halted"> {
  if (!isOpenDay(now, rules)) return "holiday";
  const { hour } = getKstParts(now);
  return hour >= hours.openHour && hour < hours.closeHour ? "open" : "closed";
}

// 현재 시각의 틱 인덱스 (0 ~ ticksPerDay-1). 장외 시간이면 null.
export function getTickIndex(
  now: Date = new Date(),
  hours: MarketHours = DEFAULT_MARKET_HOURS,
  rules: OpenDayRules = {}
): number | null {
  if (getMarketState(now, hours, rules) !== "open") return null;
  const { hour, minute } = getKstParts(now);
  const minutesSinceOpen = (hour - hours.openHour) * 60 + minute;
  return Math.min(
    Math.floor(minutesSinceOpen / TICK_INTERVAL_MINUTES),
    ticksPerDay(hours) - 1
  );
}

// 게임 날짜 + 틱 인덱스 → 실제 순간(UTC ISO). 개장 시각 기준 5분 간격.
// chartService의 tickTimeEpoch와 달리 화면용 +9h 보정이 없는 "진짜 시각"이다.
// 뉴스 published_at(장중 시간차 노출)·공시 폐장 시각 계산에 쓴다.
export function tickTimestamp(date: string, tickIndex: number, openHour: number): string {
  const open = String(openHour).padStart(2, "0");
  const base = new Date(`${date}T${open}:00:00+09:00`).getTime();
  return new Date(base + tickIndex * TICK_INTERVAL_MINUTES * 60_000).toISOString();
}

// 금액 표시: 1234567 → "1,234,567원"
export function formatMoney(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}${CURRENCY_LABEL}`;
}

// 큰 금액 축약 표시 (시가총액 등): 6.4조 → "6조 4,000억원", 8160억 → "8,160억원"
export function formatCompactMoney(amount: number): string {
  const JO = 1_0000_0000_0000; // 1조
  const EOK = 1_0000_0000; // 1억
  if (amount >= JO) {
    const jo = Math.floor(amount / JO);
    const eok = Math.round((amount % JO) / EOK);
    return eok > 0
      ? `${jo}조 ${eok.toLocaleString("ko-KR")}억${CURRENCY_LABEL}`
      : `${jo}조${CURRENCY_LABEL}`;
  }
  if (amount >= EOK) {
    return `${Math.round(amount / EOK).toLocaleString("ko-KR")}억${CURRENCY_LABEL}`;
  }
  return formatMoney(amount);
}

// ---------------------------------------------------------------------------
// 게임 날짜(YYYY-MM-DD) 단위 헬퍼 — 배치·시뮬레이션에서 사용
// ---------------------------------------------------------------------------

export interface OpenDayRules {
  closedWeekdays?: number[]; // 정기 휴장 요일 (ISO 1=월~7=일, 기본 [1,2])
  holidayExceptions?: string[]; // 임시 휴장일
  extraOpenDays?: string[]; // 휴장 요일인데 여는 날
}

export function isoWeekdayOfDate(dateStr: string): number {
  // UTC 정오로 파싱하면 타임존 영향 없이 요일 계산 가능
  const day = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day; // 1(월)~7(일)
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isOpenDate(dateStr: string, rules: OpenDayRules = {}): boolean {
  if (rules.extraOpenDays?.includes(dateStr)) return true;
  if (rules.holidayExceptions?.includes(dateStr)) return false;
  return !(rules.closedWeekdays ?? CLOSED_WEEKDAYS).includes(isoWeekdayOfDate(dateStr));
}

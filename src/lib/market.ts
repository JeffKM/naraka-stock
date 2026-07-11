// 장 운영 시간·틱 계산 유틸 (KST 기준 순수 함수)
//
// 기본 규칙 (PRD §2): 개장일(수~일) 15:00~22:00, 월·화 휴장, 5분 틱 84개.
// DB config의 예외일(holiday_exceptions / extra_open_days)은 서버 로직에서
// 이 함수들의 결과 위에 덧씌운다 (Phase 2에서 연결).

import type { MarketState } from "@/types/domain";

export const MARKET_OPEN_HOUR = 15;
export const MARKET_CLOSE_HOUR = 22;
export const TICK_INTERVAL_MINUTES = 5;
export const TICKS_PER_DAY = 84; // (22 - 15) * 60 / 5
export const CLOSED_WEEKDAYS = [1, 2]; // ISO 요일: 1=월, 2=화 (나라카 휴무일)

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

// 개장일 여부 (요일 기반 기본 규칙)
export function isOpenDay(now: Date = new Date()): boolean {
  return !CLOSED_WEEKDAYS.includes(getKstParts(now).isoWeekday);
}

// 현재 장 상태 (서킷브레이커는 DB 상태라 여기서 판정하지 않는다)
export function getMarketState(now: Date = new Date()): Exclude<MarketState, "halted"> {
  if (!isOpenDay(now)) return "holiday";
  const { hour } = getKstParts(now);
  return hour >= MARKET_OPEN_HOUR && hour < MARKET_CLOSE_HOUR ? "open" : "closed";
}

// 현재 시각의 틱 인덱스 (0~83). 장외 시간이면 null.
export function getTickIndex(now: Date = new Date()): number | null {
  if (getMarketState(now) !== "open") return null;
  const { hour, minute } = getKstParts(now);
  const minutesSinceOpen = (hour - MARKET_OPEN_HOUR) * 60 + minute;
  return Math.min(
    Math.floor(minutesSinceOpen / TICK_INTERVAL_MINUTES),
    TICKS_PER_DAY - 1
  );
}

// 금액 표시: 1234567 → "1,234,567원"
export function formatMoney(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}${CURRENCY_LABEL}`;
}

// ---------------------------------------------------------------------------
// 게임 날짜(YYYY-MM-DD) 단위 헬퍼 — 배치·시뮬레이션에서 사용
// ---------------------------------------------------------------------------

export interface OpenDayRules {
  holidayExceptions?: string[]; // 임시 휴장일
  extraOpenDays?: string[]; // 월·화인데 여는 날
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
  return !CLOSED_WEEKDAYS.includes(isoWeekdayOfDate(dateStr));
}

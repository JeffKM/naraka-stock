import "server-only";
import { ApiException } from "@/lib/api/response";
import { regenerateRemainingPath } from "@/lib/engine/randomWalk";
import { createRng } from "@/lib/engine/rng";
import {
  getKstParts,
  getTickIndex,
  addDays,
  isOpenDate,
  ticksPerDay,
  TICK_INTERVAL_MINUTES,
} from "@/lib/market";
import { loadMarketConfig } from "@/lib/marketHours";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  adjustDivisorForListing,
  adjustDivisorsForTierChange,
  indexCodeOfTier,
} from "@/services/indexService";
import type { Stock, StockTier } from "@/types/domain";

// 어드민 서비스 (T-602~T-605) — 모든 진입점은 route에서 requireAdmin을 통과한 뒤 호출된다.

// ── T-602 대시보드 ──────────────────────────────────────────────

export interface AdminDashboard {
  userCount: number;
  todayTradeCount: number;
  todayTradeVolume: number; // 체결액 합 (원)
  unusedSignupCodes: number;
  todayVisitClaims: number;
}

export async function getDashboard(): Promise<AdminDashboard> {
  const supabase = getSupabaseAdmin();
  const { date: today } = getKstParts();
  const dayStartUtc = new Date(`${today}T00:00:00+09:00`).toISOString();

  const [users, trades, codes, claims] = await Promise.all([
    supabase.from("users").select("id", { count: "exact", head: true }),
    supabase
      .from("trades")
      .select("quantity, price")
      .gte("created_at", dayStartUtc),
    supabase
      .from("signup_codes")
      .select("code", { count: "exact", head: true })
      .is("used_by", null),
    supabase
      .from("visit_claims")
      .select("user_id", { count: "exact", head: true })
      .eq("date", today),
  ]);
  if (trades.error) throw trades.error;

  return {
    userCount: users.count ?? 0,
    todayTradeCount: trades.data.length,
    todayTradeVolume: trades.data.reduce((sum, t) => sum + t.quantity * t.price, 0),
    unusedSignupCodes: codes.count ?? 0,
    todayVisitClaims: claims.count ?? 0,
  };
}

// ── T-603 코드 관리 ─────────────────────────────────────────────

function randomCode(prefix: string, length: number): string {
  // 혼동 문자(0/O, 1/I/L) 제외
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

export async function createSignupCodes(count: number): Promise<string[]> {
  if (count < 1 || count > 200) {
    throw new ApiException("VALIDATION", "1~200개까지 생성할 수 있습니다.");
  }
  const supabase = getSupabaseAdmin();
  const codes = Array.from({ length: count }, () => randomCode("NRK", 6));
  const { error } = await supabase
    .from("signup_codes")
    .insert(codes.map((code) => ({ code })));
  if (error) throw error;
  return codes;
}

export async function deleteUnusedSignupCodes(): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("signup_codes")
    .delete()
    .is("used_by", null)
    .select("code");
  if (error) throw error;
  return data.length;
}

export async function listSignupCodes(): Promise<{
  unused: number;
  used: number;
  unusedCodes: string[];
}> {
  const supabase = getSupabaseAdmin();
  const [used, unusedList] = await Promise.all([
    supabase.from("signup_codes").select("code", { count: "exact", head: true }).not("used_by", "is", null),
    // 오래된 코드부터 소진하도록 생성 순 정렬
    supabase
      .from("signup_codes")
      .select("code", { count: "exact" })
      .is("used_by", null)
      .order("created_at", { ascending: true }),
  ]);
  if (unusedList.error) throw unusedList.error;

  return {
    unused: unusedList.count ?? unusedList.data.length,
    used: used.count ?? 0,
    unusedCodes: unusedList.data.map((c) => c.code),
  };
}

// 방문 코드: 오늘부터 N일치 자동 생성(없는 날짜만) + 조회
export async function ensureVisitCodes(days: number): Promise<Array<{ date: string; code: string }>> {
  const supabase = getSupabaseAdmin();
  const { date: today } = getKstParts();
  const dates = Array.from({ length: Math.min(days, 40) }, (_, i) => addDays(today, i));

  const { data: existing, error } = await supabase
    .from("visit_codes")
    .select("date, code")
    .in("date", dates);
  if (error) throw error;
  const existingDates = new Set(existing.map((v) => v.date));

  const missing = dates
    .filter((d) => !existingDates.has(d))
    .map((date) => ({ date, code: randomCode("VISIT", 4) }));
  if (missing.length > 0) {
    const { error: insertError } = await supabase.from("visit_codes").insert(missing);
    if (insertError) throw insertError;
  }

  return [...existing, ...missing].sort((a, b) => a.date.localeCompare(b.date));
}

// ── T-604 서킷브레이커·시세 조정 ────────────────────────────────

export async function setCircuitBreaker(minutes: number | null): Promise<{ until: string | null }> {
  const supabase = getSupabaseAdmin();
  if (minutes === null) {
    await supabase.from("config").delete().eq("key", "circuit_breaker_until");
    return { until: null };
  }
  if (minutes < 1 || minutes > 60) {
    throw new ApiException("VALIDATION", "정지 시간은 1~60분이어야 합니다.");
  }
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  const { error } = await supabase
    .from("config")
    .upsert({ key: "circuit_breaker_until", value: JSON.stringify(until) });
  if (error) throw error;
  return { until };
}

// 시세 조정: 특정 종목의 남은 오늘 경로를 새 편향으로 재생성.
// durationMinutes를 주면 그 시간 동안만 편향이 걸리고, 이후는 그날 배치가
// 추첨했던 원래 편향의 드리프트로 복귀한다 (뉴스 예고와 흐름이 어긋나지 않게).
export async function triggerSurpriseEvent(
  stockCode: string,
  bias: number,
  durationMinutes: number | null = null
): Promise<{ fromTick: number; replaced: number }> {
  const supabase = getSupabaseAdmin();
  const { date: today } = getKstParts();
  const { hours, rules } = await loadMarketConfig();
  const currentTick = getTickIndex(new Date(), hours, rules);
  if (currentTick === null) {
    throw new ApiException("MARKET_CLOSED", "장중에만 발동할 수 있습니다.");
  }

  const { data: stock, error: stockError } = await supabase
    .from("stocks")
    .select("code, tier")
    .eq("code", stockCode)
    .single();
  if (stockError || !stock) {
    throw new ApiException("NOT_FOUND", "없는 종목입니다.");
  }

  const { data: currentRow, error: tickError } = await supabase
    .from("daily_ticks")
    .select("price")
    .eq("stock_code", stockCode)
    .eq("date", today)
    .eq("tick_index", currentTick)
    .single();
  if (tickError || !currentRow) {
    throw new ApiException("MARKET_CLOSED", "오늘 경로가 없습니다.");
  }

  // 오늘 상하한 기준가 (직전 개장일 종가)
  const { data: prevRows, error: prevError } = await supabase
    .from("daily_summary")
    .select("date, close")
    .eq("stock_code", stockCode)
    .lt("date", today)
    .order("date", { ascending: false })
    .limit(1);
  if (prevError) throw prevError;
  const prevClose = prevRows[0]?.close ?? currentRow.price;

  // 창 종료 후 복귀할 편향: 그날 배치가 추첨한 값 (없으면 중립)
  const { data: todayRow, error: todayError } = await supabase
    .from("daily_summary")
    .select("bias")
    .eq("stock_code", stockCode)
    .eq("date", today)
    .maybeSingle();
  if (todayError) throw todayError;
  const resumeBias = todayRow?.bias ?? 0;

  // 어드민 발동은 예측 불가여야 하므로 시각 기반 시드
  const rng = createRng(Date.now() % 0xffffffff);
  const ticks = regenerateRemainingPath(
    prevClose,
    currentRow.price,
    currentTick,
    bias,
    stock.tier as StockTier,
    rng,
    ticksPerDay(hours),
    durationMinutes === null ? null : Math.round(durationMinutes / TICK_INTERVAL_MINUTES),
    resumeBias
  );

  const { data: replaced, error: rpcError } = await supabase.rpc("replace_future_ticks", {
    p_stock_code: stockCode,
    p_date: today,
    p_from_tick: currentTick,
    p_ticks: ticks.map((t) => ({
      tick_index: t.tickIndex,
      price: t.price,
      is_halted: t.isHalted,
    })),
  });
  if (rpcError) throw rpcError;

  return { fromTick: currentTick, replaced };
}

// ── 리허설 데이터 초기화 (개장 전 1회) ──────────────────────────

export interface ResetResult {
  usersDeleted: number;
  tradesDeleted: number;
  ticksDeleted: number;
  newsDeleted: number;
}

export async function resetRehearsalData(): Promise<ResetResult> {
  const supabase = getSupabaseAdmin();

  // 기준가 날짜 = 이벤트 시작 전날 (config 기반)
  const { data: cfg, error: cfgError } = await supabase
    .from("config")
    .select("value")
    .eq("key", "event_start")
    .single();
  if (cfgError) throw cfgError;
  const baselineDate = addDays(String(cfg.value), -1);

  const { data, error } = await supabase.rpc("reset_rehearsal_data", {
    p_baseline_date: baselineDate,
  });
  if (error) throw error;
  return data as ResetResult;
}

// ── 장 운영 설정 (개장 시간·휴장 요일·예외일) ───────────────────

export interface MarketSettings {
  openHour: number;
  closeHour: number;
  closedWeekdays: number[]; // ISO 1=월 ~ 7=일
  holidayExceptions: string[]; // 임시 휴장일 (YYYY-MM-DD)
  extraOpenDays: string[]; // 휴장 요일인데 여는 날
}

// 콘솔 조회용: 전역 기본값 + 오늘 하루 오버라이드 상태
export interface MarketSettingsView extends MarketSettings {
  today: string; // 오늘 날짜 (KST)
  todayOverride: { openHour: number; closeHour: number } | null;
}

export async function getMarketSettings(): Promise<MarketSettingsView> {
  const { defaultHours, todayOverride, rules } = await loadMarketConfig();
  return {
    openHour: defaultHours.openHour,
    closeHour: defaultHours.closeHour,
    closedWeekdays: rules.closedWeekdays ?? [],
    holidayExceptions: rules.holidayExceptions ?? [],
    extraOpenDays: rules.extraOpenDays ?? [],
    today: getKstParts().date,
    todayOverride: todayOverride
      ? { openHour: todayOverride.openHour, closeHour: todayOverride.closeHour }
      : null,
  };
}

// 장 시간 변경은 익일 배치 경로부터 완전 반영된다. 이미 생성된 오늘 경로는
// 틱 수가 그대로라, 장이 길어지면 종가 동결 구간이 생긴다 (quotes가 마지막
// 틱으로 폴백). 짧아지면 남은 틱은 그냥 안 쓰인다.
export async function updateMarketSettings(input: MarketSettings): Promise<void> {
  const supabase = getSupabaseAdmin();
  const rows = [
    { key: "market_open_hour", value: input.openHour },
    { key: "market_close_hour", value: input.closeHour },
    { key: "closed_weekdays", value: input.closedWeekdays },
    { key: "holiday_exceptions", value: input.holidayExceptions },
    { key: "extra_open_days", value: input.extraOpenDays },
  ];
  const { error } = await supabase.from("config").upsert(rows);
  if (error) throw error;
}

// 당일 장 시간 오버라이드: 자정 폐장 후 ~ 당일 개장 전에만 설정할 수 있다.
// 설정하지 않으면 기본 장 시간대로 흐르고, 날짜가 지나면 자동 무시된다.
// 오늘 경로(틱)는 이미 기본 장 시간 기준으로 생성돼 있으므로, 늦게 열거나
// 일찍 닫으면 경로 일부만 쓰이고, 더 일찍 열면 남는 구간은 종가 동결이다.
export async function setTodayMarketHours(
  openHour: number,
  closeHour: number
): Promise<{ date: string }> {
  const supabase = getSupabaseAdmin();
  const { hours, rules } = await loadMarketConfig();
  const { date: today, hour } = getKstParts();

  if (!isOpenDate(today, rules)) {
    throw new ApiException("VALIDATION", "오늘은 휴장일이라 장 시간을 바꿀 수 없습니다.");
  }
  if (hour >= hours.openHour) {
    throw new ApiException(
      "VALIDATION",
      "오늘 장이 이미 개장했습니다. 당일 장 시간은 개장 전에만 바꿀 수 있습니다."
    );
  }
  if (openHour <= hour) {
    throw new ApiException("VALIDATION", "개장 시간은 현재 시각 이후로만 정할 수 있습니다.");
  }

  const { error } = await supabase.from("config").upsert({
    key: "market_hours_override",
    value: { date: today, openHour, closeHour },
  });
  if (error) throw error;
  return { date: today };
}

export async function clearTodayMarketHours(): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { hours, todayOverride } = await loadMarketConfig();

  // 오늘자 유효 오버라이드는 개장 전에만 해제 가능 (설정과 동일 규칙).
  // 지난 날짜의 잔재는 어차피 무시되므로 그냥 지운다.
  if (todayOverride && getKstParts().hour >= hours.openHour) {
    throw new ApiException(
      "VALIDATION",
      "오늘 장이 이미 개장했습니다. 당일 장 시간은 개장 전에만 되돌릴 수 있습니다."
    );
  }
  const { error } = await supabase
    .from("config")
    .delete()
    .eq("key", "market_hours_override");
  if (error) throw error;
}

// ── 종목 관리 (신규 상장·등급 변경) ─────────────────────────────

export async function listStocks(): Promise<Stock[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stocks")
    .select("code, name, tier, description, listed, shares_outstanding")
    .order("code");
  if (error) throw error;
  return data.map(({ shares_outstanding, ...s }) => ({
    ...s,
    tier: s.tier as StockTier,
    sharesOutstanding: shares_outstanding,
  }));
}

export interface CreateStockInput {
  code: string;
  name: string;
  tier: StockTier;
  description: string;
  initialPrice: number;
  sharesOutstanding: number; // 발행주식수 (시총·지수 가중치)
}

// 신규 상장: 종목 등록 + 기준가 생성. 장중이면 남은 오늘 경로까지 만들어
// 즉시 거래 가능하게 한다. 장외면 다음 배치가 자동으로 경로를 생성한다.
// 주의: 힌트 뉴스 템플릿은 종목별 수작업이라 신규 종목은 공시만 자동 발행된다.
export async function createStock(
  input: CreateStockInput
): Promise<{ tradableNow: boolean }> {
  const supabase = getSupabaseAdmin();
  const { date: today } = getKstParts();

  const { error: insertError } = await supabase.from("stocks").insert({
    code: input.code,
    name: input.name,
    tier: input.tier,
    description: input.description,
    shares_outstanding: input.sharesOutstanding,
  });
  if (insertError) {
    if (insertError.code === "23505") {
      throw new ApiException("VALIDATION", "이미 존재하는 종목 코드입니다.");
    }
    throw insertError;
  }

  // 기준가: 어제 날짜 요약으로 넣어 등락률·배치의 직전 종가 역할을 하게 한다
  const { error: summaryError } = await supabase.from("daily_summary").upsert({
    stock_code: input.code,
    date: addDays(today, -1),
    open: input.initialPrice,
    high: input.initialPrice,
    low: input.initialPrice,
    close: input.initialPrice,
    bias: 0,
  });
  if (summaryError) throw summaryError;

  // 지수 편입 보정: 새 종목 시총이 들어와도 지수 값이 튀지 않게 divisor 확대
  await adjustDivisorForListing(input.code, today);

  // 장중 상장이면 현재 틱부터 오늘 남은 경로 생성 (상장가에서 출발, 중립 드리프트)
  const { hours, rules } = await loadMarketConfig();
  const currentTick = getTickIndex(new Date(), hours, rules);
  if (currentTick === null) {
    return { tradableNow: false };
  }

  const rng = createRng(Date.now() % 0xffffffff);
  const ticks = regenerateRemainingPath(
    input.initialPrice,
    input.initialPrice,
    currentTick - 1, // 현재 틱부터 생성
    0,
    input.tier,
    rng,
    ticksPerDay(hours)
  );
  const { error: rpcError } = await supabase.rpc("replace_future_ticks", {
    p_stock_code: input.code,
    p_date: today,
    p_from_tick: currentTick - 1,
    p_ticks: ticks.map((t) => ({
      tick_index: t.tickIndex,
      price: t.price,
      is_halted: t.isHalted,
    })),
  });
  if (rpcError) throw rpcError;

  return { tradableNow: true };
}

// 등급 변경: 변동성·배당·이벤트 가중치는 다음 배치 경로부터 반영된다.
// 우량·일반 ↔ 테마 이동은 지수 소속(나스피↔나스닥)도 바뀌므로 divisor를 보정한다.
export async function updateStockTier(code: string, tier: StockTier): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: before, error: beforeError } = await supabase
    .from("stocks")
    .select("tier")
    .eq("code", code)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!before) {
    throw new ApiException("NOT_FOUND", "없는 종목입니다.");
  }
  const fromTier = before.tier as StockTier;
  if (fromTier === tier) return;

  // 지수의 마지막 종목이 빠져나가면 지수가 죽으므로 사전 차단
  if (indexCodeOfTier(fromTier) !== indexCodeOfTier(tier)) {
    const { count, error: countError } = await supabase
      .from("stocks")
      .select("code", { count: "exact", head: true })
      .eq("listed", true)
      .eq("tier", "wild");
    if (countError) throw countError;
    const wildCount = count ?? 0;
    if (fromTier === "wild" && wildCount <= 1) {
      throw new ApiException("VALIDATION", "나스닥(테마주)의 마지막 종목은 옮길 수 없습니다.");
    }
  }

  const { error } = await supabase.from("stocks").update({ tier }).eq("code", code);
  if (error) throw error;

  await adjustDivisorsForTierChange(code, fromTier, tier, getKstParts().date);
}

// ── T-605 수동 뉴스·유저 관리 ───────────────────────────────────

export interface ManualNewsInput {
  stockCode: string | null;
  grade: "disclosure" | "news" | "rumor";
  title: string;
  body: string;
}

export async function publishNews(input: ManualNewsInput): Promise<{ id: number }> {
  const supabase = getSupabaseAdmin();
  const { date: today } = getKstParts();
  const { data, error } = await supabase
    .from("news")
    .insert({
      date: today,
      stock_code: input.stockCode,
      grade: input.grade,
      title: input.title,
      body: input.body,
      is_auto: false,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export interface AdminUserInfo {
  id: number;
  nickname: string;
  cash: number;
  isBanned: boolean;
  createdAt: string;
}

export async function searchUsers(query: string): Promise<AdminUserInfo[]> {
  const supabase = getSupabaseAdmin();
  let builder = supabase
    .from("users")
    .select("id, nickname, cash, is_banned, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (query) {
    builder = builder.ilike("nickname", `%${query}%`);
  }
  const { data, error } = await builder;
  if (error) throw error;
  return data.map((u) => ({
    id: u.id,
    nickname: u.nickname,
    cash: u.cash,
    isBanned: u.is_banned,
    createdAt: u.created_at,
  }));
}

export async function setUserBanned(userId: number, banned: boolean): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("users").update({ is_banned: banned }).eq("id", userId);
  if (error) throw error;
}

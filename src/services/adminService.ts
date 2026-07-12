import "server-only";
import { ApiException } from "@/lib/api/response";
import { regenerateRemainingPath } from "@/lib/engine/randomWalk";
import { createRng } from "@/lib/engine/rng";
import { getKstParts, getTickIndex, addDays } from "@/lib/market";
import { loadMarketHours } from "@/lib/marketHours";
import { getSupabaseAdmin } from "@/lib/supabase/server";
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

export interface SignupCodeInfo {
  code: string;
  usedBy: string | null;
  createdAt: string;
}

export async function listSignupCodes(): Promise<{
  unused: number;
  used: number;
  recent: SignupCodeInfo[];
}> {
  const supabase = getSupabaseAdmin();
  const [unused, used, recent] = await Promise.all([
    supabase.from("signup_codes").select("code", { count: "exact", head: true }).is("used_by", null),
    supabase.from("signup_codes").select("code", { count: "exact", head: true }).not("used_by", "is", null),
    supabase
      .from("signup_codes")
      .select("code, created_at, users(nickname)")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (recent.error) throw recent.error;

  return {
    unused: unused.count ?? 0,
    used: used.count ?? 0,
    recent: recent.data.map((c) => ({
      code: c.code,
      usedBy: (c.users as unknown as { nickname: string } | null)?.nickname ?? null,
      createdAt: c.created_at,
    })),
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

// ── T-604 서킷브레이커·깜짝 이벤트 ──────────────────────────────

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

// 깜짝 이벤트: 특정 종목의 남은 오늘 경로를 새 편향으로 재생성
export async function triggerSurpriseEvent(
  stockCode: string,
  bias: number
): Promise<{ fromTick: number; replaced: number }> {
  const supabase = getSupabaseAdmin();
  const { date: today } = getKstParts();
  const currentTick = getTickIndex();
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

  // 어드민 발동은 예측 불가여야 하므로 시각 기반 시드
  const rng = createRng(Date.now() % 0xffffffff);
  const ticks = regenerateRemainingPath(
    prevClose,
    currentRow.price,
    currentTick,
    bias,
    stock.tier as StockTier,
    rng
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

// ── 종목 관리 (신규 상장·등급 변경) ─────────────────────────────

export async function listStocks(): Promise<Stock[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stocks")
    .select("code, name, tier, description, listed")
    .order("code");
  if (error) throw error;
  return data.map((s) => ({ ...s, tier: s.tier as StockTier }));
}

export interface CreateStockInput {
  code: string;
  name: string;
  tier: StockTier;
  description: string;
  initialPrice: number;
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

  // 장중 상장이면 현재 틱부터 오늘 남은 경로 생성 (상장가에서 출발, 중립 드리프트)
  const hours = await loadMarketHours();
  const currentTick = getTickIndex(new Date(), hours);
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
    rng
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

// 등급 변경: 변동성·배당·이벤트 가중치는 다음 배치 경로부터 반영된다
export async function updateStockTier(code: string, tier: StockTier): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stocks")
    .update({ tier })
    .eq("code", code)
    .select("code");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new ApiException("NOT_FOUND", "없는 종목입니다.");
  }
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

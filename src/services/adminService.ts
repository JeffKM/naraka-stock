import "server-only";
import { ApiException } from "@/lib/api/response";
import { realizeBias } from "@/lib/engine/bias";
import {
  generateDailyPath,
  regenerateRemainingPath,
  tickVolume,
  type Tick,
} from "@/lib/engine/randomWalk";
import { createRng } from "@/lib/engine/rng";
import {
  getKstParts,
  getMarketState,
  getTickIndex,
  addDays,
  isOpenDate,
  ticksPerDay,
  tickTimestamp,
  TICK_INTERVAL_MINUTES,
} from "@/lib/market";
import { loadMarketConfig } from "@/lib/marketHours";
import { generateRegularNews, type GeneratedNews } from "@/lib/news/generate";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  adjustDivisorForListing,
  adjustDivisorsForTierChange,
  indexCodeOfTier,
} from "@/services/indexService";
import type { AdminSignupRequest, Stock, StockSector, StockTier } from "@/types/domain";

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
      .is("used_by", null)
      .eq("is_admin", false),
    supabase
      .from("visit_claims")
      .select("user_id", { count: "exact", head: true })
      .eq("date", today),
  ]);
  if (trades.error) throw trades.error;

  return {
    userCount: users.count ?? 0,
    todayTradeCount: trades.data.length,
    todayTradeVolume: trades.data.reduce(
      (sum, t) => sum + Math.round(Number(t.quantity) * t.price),
      0
    ),
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

// isAdmin=true면 그 코드로 가입한 계정이 곧바로 어드민이 된다 (사장님 계정 발급용).
// 손님 코드(NRK-)와 접두어(ADM-)를 달리해 손에서도 구분되게 한다.
export async function createSignupCodes(
  count: number,
  isAdmin = false
): Promise<string[]> {
  const max = isAdmin ? 20 : 200;
  if (count < 1 || count > max) {
    throw new ApiException("VALIDATION", `1~${max}개까지 생성할 수 있습니다.`);
  }
  const supabase = getSupabaseAdmin();
  const codes = Array.from({ length: count }, () =>
    randomCode(isAdmin ? "ADM" : "NRK", 6)
  );
  const { error } = await supabase
    .from("signup_codes")
    .insert(codes.map((code) => ({ code, is_admin: isAdmin })));
  if (error) throw error;
  return codes;
}

// ── 손님 가입요청 승인 (T-106) ──────────────────────────────────
// 손님 코드로 들어온 가입요청은 여기서 승인/거절한다. 유저 생성·코드 소모는
// approve_signup_request DB 함수가 단일 트랜잭션으로 처리한다.

export async function listSignupRequests(): Promise<AdminSignupRequest[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("signup_requests")
    .select("id, nickname, code, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    nickname: r.nickname,
    code: r.code,
    createdAt: r.created_at,
  }));
}

export async function approveSignupRequest(
  requestId: number,
  adminId: number
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("approve_signup_request", {
    p_request_id: requestId,
    p_admin_id: adminId,
  });
  if (!error) return;
  if (error.message.includes("REQUEST_INVALID")) {
    throw new ApiException("REQUEST_INVALID", "이미 처리된 요청입니다.");
  }
  if (error.message.includes("NICKNAME_TAKEN")) {
    throw new ApiException(
      "NICKNAME_TAKEN",
      "이미 사용 중인 닉네임이라 승인할 수 없습니다."
    );
  }
  if (error.message.includes("CODE_INVALID")) {
    throw new ApiException("CODE_INVALID", "이미 사용된 가입 코드입니다.");
  }
  throw error;
}

export async function rejectSignupRequest(
  requestId: number,
  adminId: number
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("reject_signup_request", {
    p_request_id: requestId,
    p_admin_id: adminId,
  });
  if (!error) return;
  if (error.message.includes("REQUEST_INVALID")) {
    throw new ApiException("REQUEST_INVALID", "이미 처리된 요청입니다.");
  }
  throw error;
}

export async function deleteUnusedSignupCodes(): Promise<number> {
  const supabase = getSupabaseAdmin();
  // 어드민 코드는 실수로 함께 폐기되지 않도록 손님 코드만 버린다
  const { data, error } = await supabase
    .from("signup_codes")
    .delete()
    .is("used_by", null)
    .eq("is_admin", false)
    .select("code");
  if (error) throw error;
  return data.length;
}

export async function listSignupCodes(): Promise<{
  unused: number;
  used: number;
  unusedCodes: string[];
  adminUnused: number;
  adminUnusedCodes: string[];
}> {
  const supabase = getSupabaseAdmin();
  const [used, customerList, adminList] = await Promise.all([
    supabase.from("signup_codes").select("code", { count: "exact", head: true }).not("used_by", "is", null),
    // 손님 코드: 오래된 코드부터 소진하도록 생성 순 정렬
    supabase
      .from("signup_codes")
      .select("code", { count: "exact" })
      .is("used_by", null)
      .eq("is_admin", false)
      .order("created_at", { ascending: true }),
    // 어드민 코드는 손님 코드 목록에 섞이지 않게 분리해 조회한다
    supabase
      .from("signup_codes")
      .select("code", { count: "exact" })
      .is("used_by", null)
      .eq("is_admin", true)
      .order("created_at", { ascending: true }),
  ]);
  if (customerList.error) throw customerList.error;
  if (adminList.error) throw adminList.error;

  return {
    unused: customerList.count ?? customerList.data.length,
    used: used.count ?? 0,
    unusedCodes: customerList.data.map((c) => c.code),
    adminUnused: adminList.count ?? adminList.data.length,
    adminUnusedCodes: adminList.data.map((c) => c.code),
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
): Promise<{ fromTick: number; replaced: number; newsVoided: number; newsAdded: number }> {
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

  // 조정 시점 이후(아직 노출 전) 자동 정식뉴스 무효화 기준 시각
  const newsCutoff = tickTimestamp(today, currentTick, hours.openHour);

  // 창(admin bias) 이후 꼬리(resumeBias) 구간을 기준으로 정식뉴스 재생성.
  // 창 구간은 어드민 수동 찌라시가 서사를 담당하므로 자동뉴스를 만들지 않는다.
  const total = ticksPerDay(hours);
  const remaining = total - 1 - currentTick;
  const windowTickCount =
    durationMinutes === null
      ? remaining
      : Math.min(Math.max(Math.round(durationMinutes / TICK_INTERVAL_MINUTES), 1), remaining);
  const windowEndTick = currentTick + windowTickCount;

  // 꼬리가 가파른 구간 탐지창(15분=3틱)보다 짧으면 재생성하지 않는다 — 극단적으로
  // 짧은 꼬리는 스케일이 과하게 작아져 사소한 움직임이 과장된 뉴스가 되기 때문.
  const MIN_TAIL_TICKS = 3;
  let newNews: GeneratedNews[] = [];
  if (total - 1 - windowEndTick >= MIN_TAIL_TICKS) {
    const tailTicks = ticks
      .filter((t) => t.tickIndex > windowEndTick)
      .map((t) => ({ tickIndex: t.tickIndex, price: t.price }));
    // 창 끝 가격을 유사 기준가로 삼아 꼬리 등락만 판정 (화면상 꼬리 움직임과 일치)
    const windowEndPrice =
      ticks.find((t) => t.tickIndex === windowEndTick)?.price ?? currentRow.price;
    // 임계값은 꼬리 길이에 비례 축소 (짧은 꼬리도 유의미하면 뉴스가 붙도록)
    const scale = tailTicks.length / total;
    // 오늘 이 종목이 이미 쓴 정식뉴스 제목은 재사용 금지
    const usedTitles = await loadStockNewsTitles(stockCode);
    newNews = generateRegularNews(
      [{ code: stockCode, prevClose: windowEndPrice, ticks: tailTicks }],
      today,
      hours.openHour,
      rng,
      { [stockCode]: usedTitles },
      scale,
      0 // 시세 조정 꼬리는 실제 움직임만 설명 — 중립 필러 뉴스는 붙이지 않는다
    );
  }

  const { data: result, error: rpcError } = await supabase.rpc("replace_future_ticks", {
    p_stock_code: stockCode,
    p_date: today,
    p_from_tick: currentTick,
    p_ticks: ticks.map((t) => ({
      tick_index: t.tickIndex,
      price: t.price,
      is_halted: t.isHalted,
      volume: t.volume,
    })),
    p_news_cutoff: newsCutoff,
    p_new_news: newNews.map((n) => ({
      grade: n.grade,
      title: n.title,
      body: n.body,
      published_at: n.publishedAt,
    })),
  });
  if (rpcError) throw rpcError;

  return {
    fromTick: currentTick,
    replaced: result.replaced,
    newsVoided: result.newsVoided,
    newsAdded: result.newsAdded,
  };
}

// 특정 종목의 정식뉴스 제목별 누적 사용 횟수 (순환 추첨용) — 시세 조정 꼬리 뉴스용
async function loadStockNewsTitles(stockCode: string): Promise<ReadonlyMap<string, number>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("news")
    .select("title")
    .eq("stock_code", stockCode)
    .eq("grade", "news");
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const n of data ?? []) counts.set(n.title, (counts.get(n.title) ?? 0) + 1);
  return counts;
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

// 오늘 경로 재조정 결과 (장 시간 변경 직후 호출)
export interface ReconcileResult {
  adjustedStocks: number; // 경로가 재생성·연장·절단된 종목 수
  totalTicks: number; // 새 장 시간 기준 하루 틱 수
}

// 장 시간이 바뀌면 이미 생성된 오늘 경로의 틱 수가 맞지 않는다.
// (장 연장 → 남는 시간 종가 동결 / 단축 → 초과 틱 방치 → 정산 종가 오염)
// 새 장 시간 기준으로 오늘 경로를 즉시 재조정한다:
// - 개장 전: 하루 전체를 새 틱 수로 재생성 (잠정 요약 OHLC도 갱신)
// - 장중: 지나간 틱은 보존. 동결 구간(경로 밖에서 마지막 틱 폴백으로 표시·체결된
//   시간대)은 그 가격 그대로 평평하게 채우고, 이후 구간만 새로 만든다
// - 폐장 후: 새 마감보다 뒤에 남은 초과 틱만 잘라낸다 (정산 정확성)
export async function reconcileTodayTicks(): Promise<ReconcileResult | null> {
  const supabase = getSupabaseAdmin();
  const { hours, rules } = await loadMarketConfig();
  const now = new Date();
  const { date: today, hour } = getKstParts(now);
  if (!isOpenDate(today, rules)) return null;

  const totalTicks = ticksPerDay(hours);

  // 오늘 경로 전체 로드 (종목 8~10개 × 최대 288틱 — 메모리 처리에 무리 없음)
  const { data: tickRows, error: tickError } = await supabase
    .from("daily_ticks")
    .select("stock_code, tick_index, price")
    .eq("date", today)
    .order("tick_index", { ascending: true });
  if (tickError) throw tickError;
  if (!tickRows || tickRows.length === 0) return null; // 오늘 경로 없음 (배치 전)

  const byStock = new Map<string, Array<{ tick_index: number; price: number }>>();
  for (const row of tickRows) {
    const list = byStock.get(row.stock_code) ?? [];
    list.push(row);
    byStock.set(row.stock_code, list);
  }

  const [stocksRes, prevRes, todayRes] = await Promise.all([
    supabase.from("stocks").select("code, tier").eq("listed", true),
    supabase
      .from("daily_summary")
      .select("stock_code, date, close")
      .lt("date", today)
      .order("date", { ascending: false }),
    supabase.from("daily_summary").select("stock_code, bias").eq("date", today),
  ]);
  if (stocksRes.error) throw stocksRes.error;
  if (prevRes.error) throw prevRes.error;
  if (todayRes.error) throw todayRes.error;

  const prevCloses: Record<string, number> = {};
  for (const row of prevRes.data) {
    if (!(row.stock_code in prevCloses)) prevCloses[row.stock_code] = row.close;
  }
  const biases: Record<string, number> = Object.fromEntries(
    todayRes.data.map((r) => [r.stock_code, r.bias])
  );

  const state = getMarketState(now, hours, rules);
  const rng = createRng(Date.now() % 0xffffffff);
  let adjustedStocks = 0;

  for (const stock of stocksRes.data) {
    const ticks = byStock.get(stock.code);
    if (!ticks || ticks.length === 0) continue; // 장중 신규 상장 등은 createStock이 처리
    const lastIndex = ticks[ticks.length - 1].tick_index;
    const tier = stock.tier as StockTier;
    const bias = biases[stock.code] ?? 0;
    const prevClose = prevCloses[stock.code] ?? ticks[0].price;

    let fromTick: number;
    let newTicks: Tick[];

    if (state === "open") {
      if (lastIndex === totalTicks - 1) continue; // 이미 새 틱 수와 일치
      const currentTick = getTickIndex(now, hours, rules) ?? 0;
      const anchor = Math.min(currentTick, lastIndex);
      const anchorPrice = ticks[Math.min(anchor, ticks.length - 1)].price;
      // 동결 구간(경로 끝 ~ 현재)은 표시·체결됐던 마지막 틱 가격 그대로 채운다.
      // 가격 변화가 없어도(moveRate=0) baseline×noise로 거래량은 채운다 —
      // 0으로 두면 거래량 히스토그램이 이 구간만 끊긴다.
      const flat: Tick[] = [];
      for (let i = lastIndex + 1; i <= Math.min(currentTick, totalTicks - 1); i++) {
        flat.push({
          tickIndex: i,
          price: anchorPrice,
          isHalted: false,
          volume: tickVolume(tier, anchorPrice, anchorPrice, rng),
        });
      }
      fromTick = anchor;
      newTicks = [
        ...flat,
        // 편향 창 1틱(사실상 무편향) 후 그날 추첨 편향의 드리프트로 흐른다
        ...regenerateRemainingPath(
          prevClose,
          anchorPrice,
          Math.max(currentTick, anchor),
          0,
          tier,
          rng,
          totalTicks,
          1,
          bias
        ),
      ];
    } else if (hour < hours.openHour) {
      // 개장 전: 하루 전체 재생성 + 잠정 요약 OHLC 갱신
      if (lastIndex === totalTicks - 1) continue;
      const path = generateDailyPath(prevClose, realizeBias(bias, rng), tier, rng, totalTicks);
      fromTick = -1;
      newTicks = path.ticks;
      const { error: summaryError } = await supabase
        .from("daily_summary")
        .update({ open: path.open, high: path.high, low: path.low, close: path.close })
        .eq("stock_code", stock.code)
        .eq("date", today);
      if (summaryError) throw summaryError;
    } else {
      // 폐장 후: 새 마감 이후로 남은 초과 틱 절단 (마지막 틱 = 종가 보정)
      if (lastIndex <= totalTicks - 1) continue;
      fromTick = totalTicks - 1;
      newTicks = [];
    }

    const { error: rpcError } = await supabase.rpc("replace_future_ticks", {
      p_stock_code: stock.code,
      p_date: today,
      p_from_tick: fromTick,
      p_ticks: newTicks.map((t) => ({
        tick_index: t.tickIndex,
        price: t.price,
        is_halted: t.isHalted,
        volume: t.volume,
      })),
    });
    if (rpcError) throw rpcError;
    adjustedStocks++;
  }

  return adjustedStocks > 0 ? { adjustedStocks, totalTicks } : null;
}

// 장 시간 변경 시 익일 배치 경로는 자동으로 새 틱 수로 생성되고,
// 이미 생성된 오늘 경로는 reconcileTodayTicks가 즉시 재조정한다.
export async function updateMarketSettings(
  input: MarketSettings
): Promise<{ reconciled: ReconcileResult | null }> {
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

  // 폐장 시각이 바뀌면 배치 크론도 새 폐장 시각에 맞춰 재조정한다 (best-effort).
  // pg_cron 미설치(로컬)·잡 미등록이면 함수가 조용히 no-op 하므로 실패해도 무시.
  const { error: cronError } = await supabase.rpc("reschedule_daily_batch");
  if (cronError) {
    console.error("배치 크론 재조정 실패(무시):", cronError.message);
  }

  return { reconciled: await reconcileTodayTicks() };
}

// 당일 장 시간 오버라이드: 자정 폐장 후 ~ 당일 개장 전에만 설정할 수 있다.
// 설정하지 않으면 기본 장 시간대로 흐르고, 날짜가 지나면 자동 무시된다.
// 오늘 경로는 기본 장 시간 기준으로 생성돼 있으므로 즉시 새 틱 수로 재생성한다.
export async function setTodayMarketHours(
  openHour: number,
  closeHour: number
): Promise<{ date: string; reconciled: ReconcileResult | null }> {
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
  return { date: today, reconciled: await reconcileTodayTicks() };
}

export async function clearTodayMarketHours(): Promise<{
  reconciled: ReconcileResult | null;
}> {
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
  return { reconciled: await reconcileTodayTicks() };
}

// ── 종목 관리 (신규 상장·등급 변경) ─────────────────────────────

export async function listStocks(): Promise<Stock[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stocks")
    .select("code, name, tier, sector, description, listed, shares_outstanding")
    .order("code");
  if (error) throw error;
  return data.map(({ shares_outstanding, ...s }) => ({
    ...s,
    tier: s.tier as StockTier,
    sector: s.sector as StockSector,
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
      volume: t.volume,
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

// 수동 뉴스는 항상 찌라시(rumor)로 발행한다. 공시·정식뉴스는 배치가 자동 생성한다.
export interface ManualNewsInput {
  stockCode: string | null;
  source: string; // 기자·매체명 (예: "옥자", "나라카 숲")
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
      grade: "rumor",
      title: input.title,
      body: input.body,
      source: input.source,
      is_auto: false,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export interface ManualNewsListItem {
  id: number;
  date: string;
  stockCode: string | null;
  stockName: string | null;
  source: string | null;
  title: string;
  publishedAt: string;
}

// 수동 발행 뉴스(is_auto=false) 목록 — 최신순. 발행 후 관리·삭제용.
export async function listManualNews(): Promise<ManualNewsListItem[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("news")
    .select("id, date, stock_code, source, title, published_at, stocks(name)")
    .eq("is_auto", false)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((n) => ({
    id: n.id,
    date: n.date,
    stockCode: n.stock_code,
    stockName: (n.stocks as unknown as { name: string } | null)?.name ?? null,
    source: n.source,
    title: n.title,
    publishedAt: n.published_at,
  }));
}

// 수동 뉴스 단건 삭제 — is_auto=false 행만 지운다(배치 생성 뉴스 오삭제 방지).
export async function deleteManualNews(id: number): Promise<{ deleted: number }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("news")
    .delete()
    .eq("id", id)
    .eq("is_auto", false)
    .select("id");
  if (error) throw error;
  return { deleted: data?.length ?? 0 };
}

export interface AdminUserInfo {
  id: number;
  nickname: string;
  cash: number;
  isAdmin: boolean;
  isBanned: boolean;
  createdAt: string;
}

export async function searchUsers(query: string): Promise<AdminUserInfo[]> {
  const supabase = getSupabaseAdmin();
  let builder = supabase
    .from("users")
    .select("id, nickname, cash, is_admin, is_banned, created_at")
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
    isAdmin: u.is_admin,
    isBanned: u.is_banned,
    createdAt: u.created_at,
  }));
}

export async function setUserBanned(userId: number, banned: boolean): Promise<void> {
  const supabase = getSupabaseAdmin();
  // 어드민 계정은 정지 불가 — 어드민끼리 서로 정지시키는 사고 방지
  const { data: target, error: findError } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (findError) throw findError;
  if (!target) throw new ApiException("NOT_FOUND", "유저를 찾을 수 없습니다.");
  if (target.is_admin) {
    throw new ApiException("FORBIDDEN", "어드민 계정은 정지할 수 없습니다.");
  }
  const { error } = await supabase.from("users").update({ is_banned: banned }).eq("id", userId);
  if (error) throw error;
}

// 어드민 현금 지급(양수)/회수(음수). 잔고 검증·갱신·감사 로그를 DB 함수가
// 단일 트랜잭션으로 처리한다. 조정 후 잔고를 반환한다.
export async function adjustUserCash(
  userId: number,
  adminId: number,
  amount: number,
  reason: string
): Promise<{ cash: number }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("admin_adjust_cash", {
    p_user_id: userId,
    p_admin_id: adminId,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) {
    if (error.message.includes("USER_NOT_FOUND")) {
      throw new ApiException("NOT_FOUND", "유저를 찾을 수 없습니다.");
    }
    if (error.message.includes("TARGET_ADMIN")) {
      throw new ApiException("FORBIDDEN", "어드민 계정은 조정할 수 없습니다.");
    }
    if (error.message.includes("INSUFFICIENT_CASH")) {
      throw new ApiException("VALIDATION", "보유 현금보다 많이 회수할 수 없습니다.");
    }
    if (error.message.includes("AMOUNT_ZERO")) {
      throw new ApiException("VALIDATION", "0원은 조정할 수 없습니다.");
    }
    throw error;
  }
  return { cash: data as number };
}

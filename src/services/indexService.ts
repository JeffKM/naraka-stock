import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ApiException } from "@/lib/api/response";
import { loadDayLastTicks } from "@/services/tickService";
import type { IndexQuote, StockTier } from "@/types/domain";

// 시장 지수 (Phase 8): 나스피/나스닥 — 시총가중 체인
//
// 지수 = Σ(가격 × 발행주식수) / divisor, 기준일에 1,000pt로 부트스트랩.
// 구성 종목이 바뀌면(신규 상장·등급 변경) 바뀐 직후에도 지수 값이 그대로
// 이어지도록 divisor를 비율 보정한다 — divisor ×= (변경 후 시총합 / 변경 전 시총합).

export const INDEX_BASE = 1000;

// 종목 등급 → 소속 지수 (우량·일반 = 나스피, 테마 = 나스닥)
export function indexCodeOfTier(tier: StockTier): string {
  return tier === "wild" ? "NASDAK" : "NASPI";
}

export interface MarketIndexRow {
  code: string;
  name: string;
  divisor: number;
}

export async function loadIndices(): Promise<MarketIndexRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("market_indices")
    .select("code, name, divisor")
    .order("code", { ascending: false }); // 나스피(NASPI) 먼저
  if (error) throw error;
  return data.map((row) => ({ ...row, divisor: Number(row.divisor) }));
}

// 전 개장일 지수 종가 (이력이 없으면 기준 1,000pt)
export async function loadPrevIndexCloses(today: string): Promise<Record<string, number>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("index_history")
    .select("index_code, date, close")
    .lt("date", today)
    .order("date", { ascending: false });
  if (error) throw error;
  const closes: Record<string, number> = {};
  for (const row of data) {
    if (!(row.index_code in closes)) closes[row.index_code] = Number(row.close);
  }
  return closes;
}

interface IndexMember {
  code: string;
  tier: StockTier;
  sharesOutstanding: number;
}

// 현재가 스냅샷에서 지수 시세 계산 (quoteService가 이미 로드한 데이터 재사용)
// - pathByStock: 오늘 틱 인덱스 → 가격 (장중 경로). 없으면 prevClose로 대체
//   (장중 상장 종목은 상장 전 틱 가격이 없으므로 기준가로 채워 연속성 유지)
export function computeIndexQuotes(params: {
  indices: MarketIndexRow[];
  members: IndexMember[];
  prevCloses: Record<string, number>;
  pathByStock: Record<string, Record<number, number>>;
  tickIndex: number | null;
  prevIndexCloses: Record<string, number>;
  // 개장 전·휴장(tickIndex null)일 때 직전 세션 지수 라인 fallback용 경로·마지막 틱.
  // 종목 스파크라인 fallback과 동일 기준(직전 세션 시가→종가)으로 채운다.
  fallbackPathByStock?: Record<string, Record<number, number>>;
  fallbackMaxTick?: number | null;
}): IndexQuote[] {
  const {
    indices,
    members,
    prevCloses,
    pathByStock,
    tickIndex,
    prevIndexCloses,
    fallbackPathByStock,
    fallbackMaxTick,
  } = params;

  return indices.map((index) => {
    const constituents = members.filter((m) => indexCodeOfTier(m.tier) === index.code);
    const round2 = (v: number) => Math.round(v * 100) / 100;

    // 특정 경로·틱의 지수 값. tick이 null이면 직전 종가 기준가로 대체.
    const indexAt = (
      path: Record<string, Record<number, number>>,
      tick: number | null
    ): number => {
      const cap = constituents.reduce((sum, m) => {
        const price =
          (tick !== null ? path[m.code]?.[tick] : undefined) ?? prevCloses[m.code] ?? 0;
        return sum + price * m.sharesOutstanding;
      }, 0);
      return round2(cap / index.divisor);
    };

    // 개장 전·휴장: 직전 세션 지수 라인을 스파크라인 fallback으로 남기고,
    // 값·등락률도 그 세션 시가→종가 기준으로 계산해 종목 카드와 기준을 일치시킨다.
    if (tickIndex === null && fallbackPathByStock && fallbackMaxTick != null) {
      const spark: number[] = [];
      for (let t = 0; t <= fallbackMaxTick; t++) {
        spark.push(indexAt(fallbackPathByStock, t));
      }
      const open = spark[0] ?? INDEX_BASE;
      const value = spark[spark.length - 1] ?? open;
      const change = round2(value - open);
      return {
        code: index.code,
        name: index.name,
        value,
        change,
        changePercent: open > 0 ? Math.round((change / open) * 10000) / 100 : 0,
        spark,
      };
    }

    const spark: number[] = [];
    if (tickIndex !== null) {
      for (let t = 0; t <= tickIndex; t++) {
        spark.push(indexAt(pathByStock, t));
      }
    }

    const value = indexAt(pathByStock, tickIndex);
    const prevClose = prevIndexCloses[index.code] ?? INDEX_BASE;
    const change = round2(value - prevClose);
    return {
      code: index.code,
      name: index.name,
      value,
      change,
      changePercent: prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0,
      spark,
    };
  });
}

// 종목별 최신 종가 (divisor 보정 기준가) — 오늘 이하 최신, 없으면 미래 기준가 폴백
async function loadLatestCloses(today: string): Promise<Record<string, number>> {
  const supabase = getSupabaseAdmin();
  const closes: Record<string, number> = {};

  const { data: past, error: pastError } = await supabase
    .from("daily_summary")
    .select("stock_code, date, close")
    .lte("date", today)
    .order("date", { ascending: false });
  if (pastError) throw pastError;
  for (const row of past) {
    if (!(row.stock_code in closes)) closes[row.stock_code] = row.close;
  }

  const { data: future, error: futureError } = await supabase
    .from("daily_summary")
    .select("stock_code, date, close")
    .gt("date", today)
    .order("date", { ascending: true });
  if (futureError) throw futureError;
  for (const row of future) {
    if (!(row.stock_code in closes)) closes[row.stock_code] = row.close;
  }
  return closes;
}

async function loadMembers(): Promise<IndexMember[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stocks")
    .select("code, tier, shares_outstanding")
    .eq("listed", true);
  if (error) throw error;
  return data.map((s) => ({
    code: s.code,
    tier: s.tier as StockTier,
    sharesOutstanding: s.shares_outstanding,
  }));
}

async function scaleDivisor(indexCode: string, ratio: number): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("market_indices")
    .select("divisor")
    .eq("code", indexCode)
    .single();
  if (error) throw error;
  const { error: updateError } = await supabase
    .from("market_indices")
    .update({ divisor: Number(data.divisor) * ratio })
    .eq("code", indexCode);
  if (updateError) throw updateError;
}

// 신규 상장 반영: 새 종목이 편입돼도 지수 값이 튀지 않게 divisor 확대.
// 종목·기준가가 DB에 들어간 "이후"에 호출한다.
export async function adjustDivisorForListing(stockCode: string, today: string): Promise<void> {
  const members = await loadMembers();
  const added = members.find((m) => m.code === stockCode);
  if (!added) return;

  const closes = await loadLatestCloses(today);
  const indexCode = indexCodeOfTier(added.tier);
  const capsAfter = members
    .filter((m) => indexCodeOfTier(m.tier) === indexCode)
    .reduce((sum, m) => sum + (closes[m.code] ?? 0) * m.sharesOutstanding, 0);
  const addedCap = (closes[stockCode] ?? 0) * added.sharesOutstanding;
  const capsBefore = capsAfter - addedCap;
  if (capsBefore <= 0) return; // 지수의 첫 종목이면 보정 불가 — divisor 유지

  await scaleDivisor(indexCode, capsAfter / capsBefore);
}

// 등급 변경으로 소속 지수가 바뀔 때 양쪽 divisor 보정.
// 등급이 DB에 반영된 "이후"에 호출한다. 이동이 없으면(우량↔일반) no-op.
export async function adjustDivisorsForTierChange(
  stockCode: string,
  fromTier: StockTier,
  toTier: StockTier,
  today: string
): Promise<void> {
  const fromIndex = indexCodeOfTier(fromTier);
  const toIndex = indexCodeOfTier(toTier);
  if (fromIndex === toIndex) return;

  const members = await loadMembers();
  const moved = members.find((m) => m.code === stockCode);
  if (!moved) return;

  const closes = await loadLatestCloses(today);
  const movedCap = (closes[stockCode] ?? 0) * moved.sharesOutstanding;
  const capsOf = (indexCode: string) =>
    members
      .filter((m) => indexCodeOfTier(m.tier) === indexCode)
      .reduce((sum, m) => sum + (closes[m.code] ?? 0) * m.sharesOutstanding, 0);

  // 빠진 쪽: 변경 후 시총이 0이면 지수가 죽으므로 차단 (호출부에서 사전 검증 권장)
  const fromCapsAfter = capsOf(fromIndex);
  if (fromCapsAfter <= 0) {
    throw new ApiException("VALIDATION", "지수의 마지막 종목은 다른 등급군으로 옮길 수 없습니다.");
  }
  await scaleDivisor(fromIndex, fromCapsAfter / (fromCapsAfter + movedCap));

  // 들어온 쪽
  const toCapsAfter = capsOf(toIndex);
  const toCapsBefore = toCapsAfter - movedCap;
  if (toCapsBefore > 0) {
    await scaleDivisor(toIndex, toCapsAfter / toCapsBefore);
  }
}

// 일일 배치 정산: 오늘 지수 종가 기록 (종가 = 마지막 틱 가격, 멱등 upsert)
export async function recordIndexCloses(date: string): Promise<number> {
  const supabase = getSupabaseAdmin();

  const lastTicks = await loadDayLastTicks(date);
  if (Object.keys(lastTicks).length === 0) return 0; // 오늘 틱 없음 (휴장·리허설 첫날)

  const tickCloses = Object.fromEntries(
    Object.entries(lastTicks).map(([code, t]) => [code, t.price])
  );
  const [indices, members, fallbackCloses] = await Promise.all([
    loadIndices(),
    loadMembers(),
    loadLatestCloses(date),
  ]);

  const rows = indices.map((index) => {
    const cap = members
      .filter((m) => indexCodeOfTier(m.tier) === index.code)
      .reduce(
        (sum, m) => sum + (tickCloses[m.code] ?? fallbackCloses[m.code] ?? 0) * m.sharesOutstanding,
        0
      );
    return { index_code: index.code, date, close: Math.round((cap / index.divisor) * 100) / 100 };
  });

  const valid = rows.filter((r) => r.close > 0);
  if (valid.length === 0) return 0;
  const { error: upsertError } = await supabase.from("index_history").upsert(valid);
  if (upsertError) throw upsertError;
  return valid.length;
}

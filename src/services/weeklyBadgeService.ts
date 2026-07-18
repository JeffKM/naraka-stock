import "server-only";
import { ApiException } from "@/lib/api/response";
import { addDays, getKstParts, isoWeekdayOfDate } from "@/lib/market";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { WeeklyBadge, UserWeeklyBadge } from "@/types/domain";

interface BadgeRow {
  id: string;
  name: string;
  description: string;
  tie_break_note: string;
  concept: string;
  category: WeeklyBadge["category"];
  icon_symbol: string;
  is_unique: boolean;
  sort_order: number;
}

function toBadge(row: BadgeRow): WeeklyBadge {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tieBreakNote: row.tie_break_note,
    concept: row.concept,
    category: row.category,
    iconUrl: row.icon_symbol,
    isUnique: row.is_unique,
    sortOrder: row.sort_order,
  };
}

// 이번 주 시작일(월요일, 이벤트 시작일로 clamp). 클라이언트 무관, 서버 계산.
export function currentWeekStart(today: string, eventStart: string): string {
  const monday = addDays(today, -(isoWeekdayOfDate(today) - 1));
  return monday < eventStart ? eventStart : monday;
}

// 표시용 주차 = 가장 최근 정산 완료 주(weekly_badge_awards의 today 이하 최대 week_start).
// 폴백: 아직 정산된 주가 없으면(이벤트 첫 주 정산 전) 진행 중인 주(config.event_start 기반 계산).
// 배지는 "그 주 마지막 개장일" 폐장 정산 때 삽입되는데, 그 시점 시계는 이미 다음 주라
// 진행 중 주 기준으로는 방금 확정된 배지가 화면에 한 번도 노출되지 않는다.
// "지난주 우승자를 이번 주 내내 착용" UX를 위해 표시 경로(랭킹/댓글/그리드/대표배지 선택)는
// 항상 이 함수를 통해 같은 주차를 바라본다.
export async function resolveDisplayWeekStart(): Promise<string> {
  const supabase = getSupabaseAdmin();
  const today = getKstParts().date;

  const { data: latestAward, error: awardError } = await supabase
    .from("weekly_badge_awards")
    .select("week_start")
    .lte("week_start", today)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (awardError) throw awardError;
  if (latestAward) return latestAward.week_start as string;

  const { data, error } = await supabase
    .from("config")
    .select("value")
    .eq("key", "event_start")
    .maybeSingle();
  if (error) throw error;
  const eventStart = (data?.value as string) ?? "2026-08-01";
  return currentWeekStart(today, eventStart);
}

export async function listBadgeCatalog(): Promise<WeeklyBadge[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("weekly_badges")
    .select("id,name,description,tie_break_note,concept,category,icon_symbol,is_unique,sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return (data as BadgeRow[]).map(toBadge);
}

export async function getUserWeeklyBadges(
  userId: number,
  weekStart?: string,
): Promise<UserWeeklyBadge[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("weekly_badge_awards")
    .select(
      "week_start,awarded_at,metric_value,weekly_badges!inner(id,name,description,tie_break_note,concept,category,icon_symbol,is_unique,sort_order)",
    )
    .eq("user_id", userId);
  if (weekStart) query = query.eq("week_start", weekStart);
  const { data, error } = await query.order("week_start", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const badge = toBadge(
      (row as unknown as { weekly_badges: BadgeRow }).weekly_badges,
    );
    const r = row as unknown as {
      week_start: string;
      awarded_at: string;
      metric_value: number | null;
    };
    return { ...badge, weekStart: r.week_start, awardedAt: r.awarded_at, metricValue: r.metric_value };
  });
}

// 랭킹·댓글 목록의 작성자별 이번 주 대표 배지 1개 배치 조회 (N+1 방지).
// PostgREST 임베드 금지: user_id 집합으로 별도 조회 후 앱에서 합성.
export async function getRepresentativeBadges(
  userIds: number[],
  weekStart: string,
): Promise<Map<number, WeeklyBadge | null>> {
  const result = new Map<number, WeeklyBadge | null>();
  if (userIds.length === 0) return result;
  const supabase = getSupabaseAdmin();

  const [{ data: awards, error: aErr }, catalog, { data: users, error: uErr }] =
    await Promise.all([
      supabase
        .from("weekly_badge_awards")
        .select("user_id,badge_id")
        .eq("week_start", weekStart)
        .in("user_id", userIds),
      listBadgeCatalog(),
      supabase.from("users").select("id,representative_badge_id").in("id", userIds),
    ]);
  if (aErr) throw aErr;
  if (uErr) throw uErr;

  const byId = new Map(catalog.map((b) => [b.id, b]));
  // 유저별 보유 배지 집합 + sort_order 최상위 fallback
  const held = new Map<number, string[]>();
  for (const a of awards ?? []) {
    const arr = held.get(a.user_id) ?? [];
    arr.push(a.badge_id);
    held.set(a.user_id, arr);
  }
  const repChoice = new Map(
    (users ?? []).map((u) => [u.id as number, u.representative_badge_id as string | null]),
  );

  for (const uid of userIds) {
    const owned = held.get(uid) ?? [];
    if (owned.length === 0) {
      result.set(uid, null);
      continue;
    }
    const chosen = repChoice.get(uid);
    if (chosen && owned.includes(chosen)) {
      result.set(uid, byId.get(chosen) ?? null);
      continue;
    }
    // fallback: 보유 배지 중 sort_order 최상위
    const best = owned
      .map((id) => byId.get(id))
      .filter((b): b is WeeklyBadge => Boolean(b))
      .sort((a, b) => a.sortOrder - b.sortOrder)[0];
    result.set(uid, best ?? null);
  }
  return result;
}

// 대표 배지 설정: 본인이 이번 주 보유한 배지만 허용.
export async function setRepresentativeBadge(
  userId: number,
  badgeId: string | null,
  weekStart: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (badgeId !== null) {
    const { data, error } = await supabase
      .from("weekly_badge_awards")
      .select("badge_id")
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .eq("badge_id", badgeId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiException("VALIDATION", "이번 주에 보유하지 않은 배지입니다.");
  }
  const { error: updErr } = await supabase
    .from("users")
    .update({ representative_badge_id: badgeId })
    .eq("id", userId);
  if (updErr) throw updErr;
}

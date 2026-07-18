import "server-only";
import { ApiException } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getRepresentativeBadges, resolveDisplayWeekStart } from "@/services/weeklyBadgeService";
import { assertValidStickerId } from "@/services/stickerService";
import type { WeeklyBadge } from "@/types/domain";

// 종목 토론방 — 댓글 조회/작성/본인 삭제

const PAGE_SIZE = 30;
const BURST_LIMIT = 5; // 도배 방지: 최근 1분 작성 수 제한

export interface StockComment {
  id: number;
  nickname: string;
  content: string | null;
  createdAt: string;
  mine: boolean; // 내가 쓴 댓글 (삭제 버튼 노출용)
  likeCount: number; // 엄지업 수
  likedByMe: boolean; // 내가 엄지업 눌렀는지 (미로그인 시 항상 false)
  representativeBadge: WeeklyBadge | null; // 작성자 이번 주 대표 배지 (없으면 null)
  stickerId: string | null; // 첨부 스티커 id (없으면 null)
  deleted: boolean; // 묘비(deleted_at != null) 여부
  replies?: StockComment[]; // 최상위 댓글에만 채워짐
}

// 조회 컬럼 — 목록/조립에서 공용 (users는 FK 명시로 PGRST201 회피)
const COMMENT_COLUMNS =
  "id, user_id, content, created_at, sticker_id, parent_id, deleted_at, users!stock_comments_user_id_fkey(nickname)";

// 조회 row 한 건을 StockComment로 변환 (부모·답글 공용)
function toComment(
  row: {
    id: number;
    user_id: number;
    content: string | null;
    created_at: string;
    sticker_id: string | null;
    deleted_at: string | null;
    users: unknown;
  },
  likes: Map<number, { count: number; mine: boolean }>,
  badges: Map<number, WeeklyBadge | null>,
  viewerId: number | null
): StockComment {
  const like = likes.get(row.id);
  const deleted = row.deleted_at !== null;
  return {
    id: row.id,
    nickname: deleted
      ? ""
      : (row.users as { nickname: string } | null)?.nickname ?? "(탈퇴)",
    content: deleted ? null : row.content,
    createdAt: row.created_at,
    mine: !deleted && viewerId !== null && row.user_id === viewerId,
    likeCount: deleted ? 0 : like?.count ?? 0,
    likedByMe: !deleted && (like?.mine ?? false),
    representativeBadge: deleted ? null : badges.get(row.user_id) ?? null,
    stickerId: deleted ? null : row.sticker_id ?? null,
    deleted,
  };
}

// 댓글 rows의 작성자 user_id 집합으로 대표 배지를 배치 조회한다 (N+1 방지).
// PostgREST 임베드 금지 — 별도 조회 후 앱에서 합성.
async function representativeBadgesFor(
  userIds: number[]
): Promise<Map<number, WeeklyBadge | null>> {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return new Map();
  const weekStart = await resolveDisplayWeekStart();
  return getRepresentativeBadges(uniqueIds, weekStart);
}

// 댓글 id 목록의 엄지업 수 + 뷰어 본인 반응 여부를 한 번에 집계한다.
// 소규모(페이지당 30개)이므로 반응 행을 전부 가져와 JS에서 합산한다.
async function likeSummary(
  commentIds: number[],
  viewerId: number | null
): Promise<Map<number, { count: number; mine: boolean }>> {
  const summary = new Map<number, { count: number; mine: boolean }>();
  if (commentIds.length === 0) return summary;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("comment_reactions")
    .select("comment_id, user_id")
    .in("comment_id", commentIds);
  if (error) throw error;
  for (const row of data) {
    const entry = summary.get(row.comment_id) ?? { count: 0, mine: false };
    entry.count += 1;
    if (viewerId !== null && row.user_id === viewerId) entry.mine = true;
    summary.set(row.comment_id, entry);
  }
  return summary;
}

export async function listComments(
  stockCode: string,
  viewerId: number | null
): Promise<StockComment[]> {
  const supabase = getSupabaseAdmin();

  // 1) 최상위 댓글 최신순 PAGE_SIZE개
  const { data: parents, error: pErr } = await supabase
    .from("stock_comments")
    .select(COMMENT_COLUMNS)
    .eq("stock_code", stockCode)
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (pErr) throw pErr;

  // 2) 그 부모들의 답글 전체 (대화 흐름 = 오래된순)
  const parentIds = parents.map((row) => row.id);
  let replies: typeof parents = [];
  if (parentIds.length > 0) {
    const { data: replyRows, error: rErr } = await supabase
      .from("stock_comments")
      .select(COMMENT_COLUMNS)
      .in("parent_id", parentIds)
      .order("created_at", { ascending: true });
    if (rErr) throw rErr;
    replies = replyRows;
  }

  // 좋아요·배지 집계는 부모+답글 전체 id로 한 번에 (N+1 방지)
  const allRows = [...parents, ...replies];
  const likes = await likeSummary(
    allRows.map((row) => row.id),
    viewerId
  );
  const badges = await representativeBadgesFor(allRows.map((row) => row.user_id));

  // 부모별 답글 묶기
  const repliesByParent = new Map<number, StockComment[]>();
  for (const row of replies) {
    const mapped = toComment(row, likes, badges, viewerId);
    const list = repliesByParent.get(row.parent_id as number) ?? [];
    list.push(mapped);
    repliesByParent.set(row.parent_id as number, list);
  }

  return parents.map((row) => ({
    ...toComment(row, likes, badges, viewerId),
    replies: repliesByParent.get(row.id) ?? [],
  }));
}

export async function createComment(
  userId: number,
  stockCode: string,
  content: string | null,
  stickerId: string | null,
  parentId: number | null
): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (!content && !stickerId) {
    throw new ApiException("VALIDATION", "내용이나 스티커를 입력해주세요.");
  }

  const { data: stock, error: stockError } = await supabase
    .from("stocks")
    .select("code")
    .eq("code", stockCode)
    .maybeSingle();
  if (stockError) throw stockError;
  if (!stock) {
    throw new ApiException("NOT_FOUND", "없는 종목입니다.");
  }

  // 답글이면 부모 검증: 존재·같은 종목·최상위(2단계 제한)·묘비 아님
  if (parentId !== null) {
    const { data: parent, error: parentError } = await supabase
      .from("stock_comments")
      .select("id, stock_code, parent_id, deleted_at")
      .eq("id", parentId)
      .maybeSingle();
    if (parentError) throw parentError;
    if (!parent || parent.stock_code !== stockCode) {
      throw new ApiException("NOT_FOUND", "없는 댓글입니다.");
    }
    if (parent.parent_id !== null) {
      throw new ApiException("VALIDATION", "답글에는 답글을 달 수 없습니다.");
    }
    if (parent.deleted_at !== null) {
      throw new ApiException("VALIDATION", "삭제된 댓글에는 답글을 달 수 없습니다.");
    }
  }

  if (stickerId) await assertValidStickerId(stickerId);

  // 도배 방지: 최근 1분 작성 수 제한 (부모·답글 공통)
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error: countError } = await supabase
    .from("stock_comments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (countError) throw countError;
  if ((count ?? 0) >= BURST_LIMIT) {
    throw new ApiException("VALIDATION", "너무 빨라요! 잠시 후 다시 남겨주세요.");
  }

  const { error } = await supabase.from("stock_comments").insert({
    user_id: userId,
    stock_code: stockCode,
    content,
    sticker_id: stickerId,
    parent_id: parentId,
  });
  if (error) throw error;
}

// 본인 댓글만 수정 (묘비는 수정 불가)
export async function updateComment(
  userId: number,
  commentId: number,
  content: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stock_comments")
    .update({ content })
    .eq("id", commentId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new ApiException("NOT_FOUND", "수정할 수 없는 댓글입니다.");
  }
}

// 삭제 공용: 답글이 있으면 묘비(소프트), 없으면 하드 삭제.
// count-확인과 삭제를 DB 함수 한 트랜잭션으로 묶어 경합 시 답글 유실을 막는다.
// restrictUserId가 있으면 본인 것만(비어드민), null이면 무제한(어드민).
async function performDelete(
  commentId: number,
  restrictUserId: number | null
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("delete_comment", {
    p_comment_id: commentId,
    p_restrict_user_id: restrictUserId,
  });
  if (error) throw error;
  if (data === null) {
    throw new ApiException("NOT_FOUND", "삭제할 수 없는 댓글입니다.");
  }
}

// 본인 댓글만 삭제할 수 있다
export async function deleteComment(userId: number, commentId: number): Promise<void> {
  return performDelete(commentId, userId);
}

// 어드민은 작성자와 무관하게 어떤 댓글이든 삭제할 수 있다 (부적절한 글 관리용)
export async function adminDeleteComment(commentId: number): Promise<void> {
  return performDelete(commentId, null);
}

// 댓글 엄지업 토글: 이미 눌렀으면 취소, 아니면 추가. 새 상태와 카운트를 돌려준다.
export async function toggleCommentLike(
  userId: number,
  commentId: number
): Promise<{ liked: boolean; likeCount: number }> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: selError } = await supabase
    .from("comment_reactions")
    .select("comment_id")
    .eq("comment_id", commentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (selError) throw selError;

  if (existing) {
    const { error } = await supabase
      .from("comment_reactions")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("comment_reactions")
      .insert({ comment_id: commentId, user_id: userId });
    if (error) {
      // FK 위반(23503) = 없는 댓글 → NOT_FOUND.
      // 유니크 위반(23505)은 동시 더블탭 경합으로 이미 좋아요가 기록된 것이라 성공 처리.
      // 그 외 에러는 그대로 던져 handleApiError가 로깅·INTERNAL 응답하게 둔다.
      if (error.code === "23503") {
        throw new ApiException("NOT_FOUND", "없는 댓글입니다.");
      }
      if (error.code !== "23505") {
        throw error;
      }
    }
  }

  const { count, error: countError } = await supabase
    .from("comment_reactions")
    .select("comment_id", { count: "exact", head: true })
    .eq("comment_id", commentId);
  if (countError) throw countError;

  return { liked: !existing, likeCount: count ?? 0 };
}

// 토론뷰용: 전 종목 댓글을 시간순으로 합쳐 종목 태그와 함께 돌려준다 (읽기 전용 집약 뷰).
export interface DiscussionComment extends StockComment {
  stockCode: string;
  stockName: string;
  replyCount: number;
}

export async function listAllComments(
  viewerId: number | null,
  page: number
): Promise<DiscussionComment[]> {
  const supabase = getSupabaseAdmin();
  const from = (page - 1) * PAGE_SIZE;
  const { data, error } = await supabase
    .from("stock_comments")
    .select(
      "id, user_id, stock_code, content, created_at, sticker_id, parent_id, deleted_at, users!stock_comments_user_id_fkey(nickname), stocks(name)"
    )
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;

  const ids = data.map((row) => row.id);
  const likes = await likeSummary(ids, viewerId);
  const badges = await representativeBadgesFor(data.map((row) => row.user_id));

  // 답글 개수 집계: 이 페이지 부모들의 자식을 한 번에 조회해 JS 합산
  const replyCounts = new Map<number, number>();
  if (ids.length > 0) {
    const { data: childRows, error: childError } = await supabase
      .from("stock_comments")
      .select("parent_id")
      .in("parent_id", ids);
    if (childError) throw childError;
    for (const c of childRows) {
      const pid = c.parent_id as number;
      replyCounts.set(pid, (replyCounts.get(pid) ?? 0) + 1);
    }
  }

  return data.map((row) => ({
    ...toComment(row, likes, badges, viewerId),
    stockCode: row.stock_code,
    stockName: (row.stocks as unknown as { name: string } | null)?.name ?? row.stock_code,
    replyCount: replyCounts.get(row.id) ?? 0,
  }));
}

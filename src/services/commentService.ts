import "server-only";
import { ApiException } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// 종목 토론방 — 댓글 조회/작성/본인 삭제

const PAGE_SIZE = 30;
const BURST_LIMIT = 5; // 도배 방지: 최근 1분 작성 수 제한

export interface StockComment {
  id: number;
  nickname: string;
  content: string;
  createdAt: string;
  mine: boolean; // 내가 쓴 댓글 (삭제 버튼 노출용)
}

export async function listComments(
  stockCode: string,
  viewerId: number | null
): Promise<StockComment[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stock_comments")
    .select("id, user_id, content, created_at, users(nickname)")
    .eq("stock_code", stockCode)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    nickname:
      (row.users as unknown as { nickname: string } | null)?.nickname ?? "(탈퇴)",
    content: row.content,
    createdAt: row.created_at,
    mine: viewerId !== null && row.user_id === viewerId,
  }));
}

export async function createComment(
  userId: number,
  stockCode: string,
  content: string
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: stock, error: stockError } = await supabase
    .from("stocks")
    .select("code")
    .eq("code", stockCode)
    .maybeSingle();
  if (stockError) throw stockError;
  if (!stock) {
    throw new ApiException("NOT_FOUND", "없는 종목입니다.");
  }

  // 도배 방지: 최근 1분 작성 수 제한
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

  const { error } = await supabase
    .from("stock_comments")
    .insert({ user_id: userId, stock_code: stockCode, content });
  if (error) throw error;
}

// 본인 댓글만 수정할 수 있다
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
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new ApiException("NOT_FOUND", "수정할 수 없는 댓글입니다.");
  }
}

// 본인 댓글만 삭제할 수 있다
export async function deleteComment(userId: number, commentId: number): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stock_comments")
    .delete()
    .eq("id", commentId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new ApiException("NOT_FOUND", "삭제할 수 없는 댓글입니다.");
  }
}

import "server-only";
import { ApiException } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type {
  AdminSupportPost,
  SupportCategory,
  SupportPost,
  SupportStatus,
} from "@/types/domain";

// 고객센터 게시판 — 유저 접수 + 운영자 답변/완료 처리

const DAILY_POST_LIMIT = 10; // 도배 방지

interface SupportPostRow {
  id: number;
  category: string;
  content: string;
  status: string;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

function toPost(row: SupportPostRow): SupportPost {
  return {
    id: row.id,
    category: row.category as SupportCategory,
    content: row.content,
    status: row.status as SupportStatus,
    reply: row.reply,
    repliedAt: row.replied_at,
    createdAt: row.created_at,
  };
}

export async function createSupportPost(
  userId: number,
  category: SupportCategory,
  content: string
): Promise<SupportPost> {
  const supabase = getSupabaseAdmin();

  // 도배 방지: 최근 24시간 작성 수 제한
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("support_posts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (countError) throw countError;
  if ((count ?? 0) >= DAILY_POST_LIMIT) {
    throw new ApiException("VALIDATION", "하루에 10건까지만 접수할 수 있습니다.");
  }

  const { data, error } = await supabase
    .from("support_posts")
    .insert({ user_id: userId, category, content })
    .select("id, category, content, status, reply, replied_at, created_at")
    .single();
  if (error) throw error;
  return toPost(data);
}

export async function listMySupportPosts(userId: number): Promise<SupportPost[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("support_posts")
    .select("id, category, content, status, reply, replied_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data.map(toPost);
}

// 운영자: 전체 목록 (status 지정 시 해당 상태만)
export async function listSupportPosts(
  status: SupportStatus | null
): Promise<AdminSupportPost[]> {
  const supabase = getSupabaseAdmin();
  let builder = supabase
    .from("support_posts")
    .select("id, category, content, status, reply, replied_at, created_at, users(nickname)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) {
    builder = builder.eq("status", status);
  }
  const { data, error } = await builder;
  if (error) throw error;
  return data.map((row) => ({
    ...toPost(row),
    nickname:
      (row.users as unknown as { nickname: string } | null)?.nickname ?? "(탈퇴)",
  }));
}

// 운영자: 답변 저장 및 상태 변경 (reply를 주면 답변 시각도 갱신)
export async function answerSupportPost(input: {
  id: number;
  reply?: string;
  status?: SupportStatus;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const patch: Record<string, unknown> = {};
  if (input.reply !== undefined) {
    patch.reply = input.reply || null;
    patch.replied_at = input.reply ? new Date().toISOString() : null;
  }
  if (input.status !== undefined) {
    patch.status = input.status;
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiException("VALIDATION", "변경할 내용이 없습니다.");
  }

  const { data, error } = await supabase
    .from("support_posts")
    .update(patch)
    .eq("id", input.id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new ApiException("NOT_FOUND", "없는 게시글입니다.");
  }
}

import "server-only";
import { ApiException } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getSession } from "./session";

export interface AuthedUser {
  id: number;
  nickname: string;
  cash: number;
  isAdmin: boolean;
}

// 로그인 필수 API의 공통 가드.
// 세션 검증 → DB에서 유저 조회 → 정지 계정 차단 (T-105).
// DB를 매번 조회하므로 정지·삭제가 즉시 반영된다 (토큰만 믿지 않는다).
export async function requireUser(): Promise<AuthedUser> {
  const session = await getSession();
  if (!session) {
    throw new ApiException("UNAUTHORIZED", "로그인이 필요합니다.");
  }

  const supabase = getSupabaseAdmin();
  const { data: user, error } = await supabase
    .from("users")
    .select("id, nickname, cash, is_admin, is_banned")
    .eq("id", session.uid)
    .single();

  if (error || !user) {
    throw new ApiException("UNAUTHORIZED", "존재하지 않는 계정입니다.");
  }
  if (user.is_banned) {
    throw new ApiException("BANNED", "정지된 계정입니다. 매장에 문의해주세요.");
  }

  return {
    id: user.id,
    nickname: user.nickname,
    cash: user.cash,
    isAdmin: user.is_admin,
  };
}

// 어드민 전용 가드 (Phase 6에서 사용)
export async function requireAdmin(): Promise<AuthedUser> {
  const user = await requireUser();
  if (!user.isAdmin) {
    throw new ApiException("FORBIDDEN", "접근 권한이 없습니다.");
  }
  return user;
}

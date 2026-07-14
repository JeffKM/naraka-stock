import "server-only";
import { ApiException } from "@/lib/api/response";
import { isNicknameAllowed } from "@/lib/auth/nickname";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { LoginInput, SignupInput } from "@/lib/validation/auth";

// DB 함수가 raise exception으로 던진 도메인 오류를 ApiException으로 변환
function mapDbError(message: string): ApiException | null {
  if (message.includes("CODE_INVALID")) {
    return new ApiException("CODE_INVALID", "유효하지 않은 가입 코드입니다.");
  }
  if (message.includes("NICKNAME_TAKEN")) {
    return new ApiException("NICKNAME_TAKEN", "이미 사용 중인 닉네임입니다.");
  }
  if (message.includes("REQUEST_DUPLICATE")) {
    return new ApiException(
      "REQUEST_DUPLICATE",
      "이미 접수된 가입 요청입니다. 매장 승인을 기다려주세요."
    );
  }
  return null;
}

export interface AuthResult {
  nickname: string;
  isAdmin: boolean;
  // active: 계정 생성·자동 로그인 완료, pending: 가입요청 접수(승인 대기, 세션 없음)
  status: "active" | "pending";
}

// 가입 (T-101): 코드 검증→유저 생성→코드 소멸은 DB 함수 단일 트랜잭션
export async function signup(input: SignupInput): Promise<AuthResult> {
  if (!isNicknameAllowed(input.nickname)) {
    throw new ApiException("VALIDATION", "사용할 수 없는 닉네임입니다.");
  }

  const passwordHash = await hashPassword(input.password);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("signup_user", {
    p_code: input.code.trim(),
    p_nickname: input.nickname,
    p_password_hash: passwordHash,
  });

  if (error) {
    throw mapDbError(error.message) ?? error;
  }

  // signup_user는 status로 분기 결과를 알려준다.
  //   - pending: 손님 코드 → 가입요청만 접수됨. 세션을 만들지 않고 매장 승인을 기다린다.
  //   - active: 어드민 코드 → 계정 생성 완료. 종전대로 자동 로그인한다.
  const result = data as
    | { status: "pending" }
    | { status: "active"; id: number; is_admin: boolean };

  if (result.status === "pending") {
    return { nickname: input.nickname, isAdmin: false, status: "pending" };
  }

  await createSession({
    uid: result.id,
    nickname: input.nickname,
    isAdmin: result.is_admin,
  });
  return { nickname: input.nickname, isAdmin: result.is_admin, status: "active" };
}

// 로그인 (T-102): 계정 존재 여부를 노출하지 않도록 실패 메시지는 하나로 통일
export async function login(input: LoginInput): Promise<AuthResult> {
  const supabase = getSupabaseAdmin();
  const { data: user } = await supabase
    .from("users")
    .select("id, nickname, password_hash, is_admin, is_banned")
    .eq("nickname", input.nickname)
    .single();

  const invalid = new ApiException(
    "UNAUTHORIZED",
    "닉네임 또는 비밀번호가 올바르지 않습니다."
  );

  if (!user) throw invalid;

  const passwordOk = await verifyPassword(input.password, user.password_hash);
  if (!passwordOk) throw invalid;

  // 정지 계정은 로그인 자체를 차단 (T-105)
  if (user.is_banned) {
    throw new ApiException("BANNED", "정지된 계정입니다. 매장에 문의해주세요.");
  }

  await createSession({
    uid: user.id,
    nickname: user.nickname,
    isAdmin: user.is_admin,
  });
  return { nickname: user.nickname, isAdmin: user.is_admin, status: "active" };
}

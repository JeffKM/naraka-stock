import { SignJWT, jwtVerify } from "jose";

// JWT 서명·검증 (엣지 안전 — next/headers 의존 없음, proxy.ts에서도 사용)

export const SESSION_COOKIE_NAME = "naraka_session";
export const SESSION_DAYS = 40; // 이벤트 한 달 + 여유

export interface SessionPayload {
  uid: number;
  nickname: string;
  isAdmin: boolean;
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET 환경 변수가 없거나 너무 짧습니다.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.uid !== "number" || typeof payload.nickname !== "string") {
      return null;
    }
    return {
      uid: payload.uid,
      nickname: payload.nickname,
      isAdmin: payload.isAdmin === true,
    };
  } catch {
    return null; // 만료·위조 토큰은 비로그인 취급
  }
}

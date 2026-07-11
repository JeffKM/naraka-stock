import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/token";

// 낙관적 라우트 보호 (Next.js 16 proxy — 구 middleware).
// 쿠키의 JWT 서명만 검증한다 (DB 조회 없음). 정지·삭제 계정의 최종 차단은
// 각 API의 requireUser 가드가 담당한다.

const PROTECTED_PREFIXES = ["/portfolio", "/history"];
const AUTH_PAGES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  // 비로그인 → 보호 라우트 접근 시 로그인으로 (원래 목적지 유지)
  if (!session && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // 로그인 상태 → 로그인/가입 페이지는 홈으로
  if (session && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/portfolio/:path*", "/history/:path*", "/login", "/signup"],
};

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/token";

// 낙관적 라우트 보호 (Next.js 16 proxy — 구 middleware).
// 쿠키의 JWT 서명만 검증한다 (DB 조회 없음). 정지·삭제 계정의 최종 차단은
// 각 API의 requireUser 가드가 담당한다.
//
// 어드민(사장님) 계정은 방문자 페이지가 필요 없으므로 항상 /admin으로 보낸다.

const PROTECTED_PREFIXES = ["/portfolio", "/history", "/admin"];
const AUTH_PAGES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  // 어드민 → 방문자 페이지 대신 운영자 콘솔로
  if (session?.isAdmin && !pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

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
  // API·정적 자산·파일 확장자가 있는 경로를 제외한 모든 페이지
  matcher: ["/((?!api|_next|favicon\\.ico|.*\\..*).*)"],
};

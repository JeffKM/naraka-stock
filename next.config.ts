import type { NextConfig } from "next";

// 모든 응답에 적용할 공통 보안 헤더
// 참고: 영상 "1인 개발자 보안 기법" #5 (리버스 프록시/보안 헤더)
// HTTPS/TLS 종단은 Vercel 엣지가 담당하고, 여기서는 애플리케이션 레벨 헤더를 일괄 적용한다.
const securityHeaders = [
  // 클릭재킹 방지 — 외부 사이트에서 iframe으로 감싸는 것을 차단
  { key: "X-Frame-Options", value: "DENY" },
  // MIME 스니핑 방지 — 브라우저가 Content-Type을 임의 추론하지 못하게 함
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 리퍼러 최소 노출 — 크로스 오리진에는 오리진만 전송
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // HTTPS 강제 (1년) — 이후 접속은 항상 HTTPS로 승격
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // 불필요한 브라우저 기능 권한 차단
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // 홈 디렉터리의 다른 lockfile 때문에 워크스페이스 루트 추론이 어긋나는 것을 방지
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

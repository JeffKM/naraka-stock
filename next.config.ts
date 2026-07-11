import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 홈 디렉터리의 다른 lockfile 때문에 워크스페이스 루트 추론이 어긋나는 것을 방지
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

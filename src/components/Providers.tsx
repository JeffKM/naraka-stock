"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

// 클라이언트 전역 프로바이더 (TanStack Query + next-themes)
// 폴링 전략(장중 5분 틱 동기화)은 Phase 4에서 쿼리별로 설정한다.
// 색상 모드: 다크 기본, 설정 모달에서 다크/라이트 수동 전환 (시스템 연동 없음)
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

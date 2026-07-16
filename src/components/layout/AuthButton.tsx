"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getJson, postJson } from "@/lib/api/client";
import type { Me } from "@/types/domain";

// 헤더 우측 로그인/로그아웃 버튼
export function AuthButton() {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => getJson<Me>("/api/auth/me"),
    retry: false,
    staleTime: 60_000,
  });

  if (isLoading) return null;

  if (!me) {
    return (
      <Button size="sm" variant="outline" asChild>
        {/* Next Link 대신 일반 앵커(하드 내비게이션). 좀비 세션에서 /login 프리페치가
            홈 리다이렉트로 라우터 캐시에 박히면 클릭이 튕기므로, 항상 서버로 최신 이동한다.
            (로그아웃도 같은 이유로 window.location을 사용) */}
        <a href="/login">로그인</a>
      </Button>
    );
  }

  async function logout() {
    await postJson("/api/auth/logout");
    window.location.href = "/login"; // 세션·캐시 완전 초기화를 위해 전체 이동
  }

  return (
    <Button size="sm" variant="ghost" onClick={logout} className="text-muted-foreground">
      로그아웃
    </Button>
  );
}

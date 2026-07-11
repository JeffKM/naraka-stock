"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
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
        <Link href="/login">로그인</Link>
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

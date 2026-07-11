"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getJson, postJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";
import type { Me } from "@/types/domain";

// 내 지갑 — Phase 3(T-304)에서 보유 종목·수익률로 확장 예정.
// 현재는 현금 잔고 + 방문 보너스 입력 + 로그아웃 (Phase 1 검증 범위).
export default function PortfolioPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [bonusCode, setBonusCode] = useState("");
  const [claiming, setClaiming] = useState(false);

  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => getJson<Me>("/api/auth/me"),
  });

  async function claimBonus() {
    if (!bonusCode.trim() || claiming) return;
    setClaiming(true);
    try {
      const { cash } = await postJson<{ cash: number }>("/api/bonus", { code: bonusCode });
      toast.success(`방문 보너스 +100,000원! 잔고 ${formatMoney(cash)}`);
      setBonusCode("");
      queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "보너스 수령에 실패했습니다.");
    } finally {
      setClaiming(false);
    }
  }

  async function logout() {
    await postJson("/api/auth/logout");
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">내 지갑</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isLoading ? <Skeleton className="h-5 w-24" /> : `${me?.nickname}님의 계좌`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">보유 현금</p>
          {isLoading ? (
            <Skeleton className="mt-1 h-8 w-40" />
          ) : (
            <p className="text-2xl font-bold">{formatMoney(me?.cash ?? 0)}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">매장 방문 보너스</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            매장에 게시된 오늘의 코드를 입력하면 +100,000원 (1일 1회)
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="오늘의 방문 코드"
              value={bonusCode}
              onChange={(e) => setBonusCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && claimBonus()}
            />
            <Button onClick={claimBonus} disabled={claiming || !bonusCode.trim()}>
              받기
            </Button>
          </div>
        </CardContent>
      </Card>

      <Button variant="outline" onClick={logout}>
        로그아웃
      </Button>
    </div>
  );
}

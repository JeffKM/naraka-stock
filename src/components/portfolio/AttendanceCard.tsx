"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getJson, postJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";

interface AttendanceStatus {
  claimedToday: boolean;
  currentStreak: number;
  nextStreak: number;
  nextAmount: number;
}

// 출석 보너스 카드 — 하루 1회 접속만으로 스트릭 단계별 현금 지급
export function AttendanceCard() {
  const queryClient = useQueryClient();
  const [claiming, setClaiming] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["attendance"],
    queryFn: () => getJson<AttendanceStatus>("/api/attendance"),
  });

  async function claim() {
    if (claiming || status?.claimedToday) return;
    setClaiming(true);
    try {
      const { amount, streak, cash } = await postJson<{
        cash: number;
        streak: number;
        amount: number;
      }>("/api/attendance");
      toast.success(
        `출석 보너스 +${formatMoney(amount)}! 잔고 ${formatMoney(cash)} · ${streak}일 연속 출석 중`
      );
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "출석 보너스 수령에 실패했습니다.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">출석 보너스</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading || !status ? (
          <Skeleton className="h-10 w-full" />
        ) : status.claimedToday ? (
          <p className="text-sm text-muted-foreground">
            오늘 출석 완료 · {status.currentStreak}일 연속 출석 중
            <br />
            내일 오면 {formatMoney(status.nextAmount)}을 받아요
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              오늘도 와줬네요! {status.nextStreak}일차 출석 보너스 {formatMoney(status.nextAmount)}
              {status.currentStreak === 0 && " (매일 오면 점점 커져요)"}
            </p>
            <Button onClick={claim} disabled={claiming}>
              출석 보너스 받기
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

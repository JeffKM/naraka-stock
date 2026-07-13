"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api/client";

// 리허설 데이터 초기화 (개장 전 1회, 파괴적 작업)
export function ResetSection() {
  const queryClient = useQueryClient();
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);

  async function reset() {
    if (confirmText !== "초기화" || running) return;
    setRunning(true);
    try {
      const result = await postJson<{
        usersDeleted: number;
        tradesDeleted: number;
        newsDeleted: number;
      }>("/api/admin/reset", { confirm: confirmText });
      toast.success(
        `초기화 완료 — 유저 ${result.usersDeleted}명, 거래 ${result.tradesDeleted}건, 뉴스 ${result.newsDeleted}건 삭제`
      );
      setConfirmText("");
      queryClient.invalidateQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "초기화 실패");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">
          리허설 데이터 초기화
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          개장(8/1) 전 마지막 준비 단계입니다. 일반 유저 계정·거래·뉴스·가격 데이터를 모두
          지우고 기준가만 남깁니다. <b>어드민 계정·미사용 가입 코드·방문 코드는 유지</b>
          됩니다. 되돌릴 수 없습니다.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder='확인 문구 "초기화" 입력'
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <Button
            variant="destructive"
            onClick={reset}
            disabled={confirmText !== "초기화" || running}
          >
            {running ? "초기화 중..." : "실행"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

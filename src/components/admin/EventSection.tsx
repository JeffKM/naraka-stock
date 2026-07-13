"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api/client";

// 시장 이벤트: 전 종목 거래 정지 (서킷브레이커).
// 종목별 시세 조정은 종목 관리에서 종목을 눌러 발동한다.
export function EventSection() {
  const queryClient = useQueryClient();
  const [cbMinutes, setCbMinutes] = useState("10");

  async function circuitBreaker(minutes: number | null) {
    try {
      await postJson("/api/admin/circuit-breaker", { minutes });
      toast.success(minutes ? `서킷브레이커 ${minutes}분 발동` : "서킷브레이커 해제");
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">시장 이벤트</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={60}
            value={cbMinutes}
            onChange={(e) => setCbMinutes(e.target.value)}
            className="w-20"
          />
          <span className="text-sm text-muted-foreground">분</span>
          <Button
            variant="destructive"
            onClick={() => circuitBreaker(Number(cbMinutes))}
          >
            서킷브레이커 발동
          </Button>
          <Button variant="outline" onClick={() => circuitBreaker(null)}>
            해제
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          전 종목 거래가 지정 시간 동안 정지됩니다. 종목별 시세 조정은 위 종목
          관리에서 종목을 눌러 발동하세요.
        </p>
      </CardContent>
    </Card>
  );
}

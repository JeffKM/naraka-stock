"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api/client";
import { useQuotes } from "@/hooks/useQuotes";

export function EventSection() {
  const { data: quotes } = useQuotes();
  const queryClient = useQueryClient();
  const [stock, setStock] = useState("OKJA");
  const [bias, setBias] = useState("-30");

  async function circuitBreaker(minutes: number | null) {
    try {
      await postJson("/api/admin/circuit-breaker", { minutes });
      toast.success(minutes ? `서킷브레이커 ${minutes}분 발동` : "서킷브레이커 해제");
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    }
  }

  async function surprise() {
    try {
      const result = await postJson<{ fromTick: number; replaced: number }>(
        "/api/admin/surprise",
        { stockCode: stock, bias: Number(bias) }
      );
      toast.success(`${stock} 경로 재생성 (틱 ${result.fromTick} 이후 ${result.replaced}개)`);
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["chart", stock] });
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
        <div className="flex gap-2">
          <Button variant="destructive" onClick={() => circuitBreaker(10)}>
            ⚡ 서킷브레이커 10분
          </Button>
          <Button variant="outline" onClick={() => circuitBreaker(null)}>
            해제
          </Button>
        </div>
        <div className="flex gap-2">
          <select
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            className="rounded-lg border bg-background px-2 text-sm"
          >
            {quotes?.quotes.map((q) => (
              <option key={q.code} value={q.code}>
                {q.name}
              </option>
            ))}
          </select>
          <Input
            type="number"
            value={bias}
            onChange={(e) => setBias(e.target.value)}
            className="w-20"
            placeholder="편향"
          />
          <Button onClick={surprise}>💥 깜짝 이벤트</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          깜짝 이벤트는 남은 오늘 경로를 지정 편향으로 다시 뽑습니다 (장중에만 가능)
        </p>
      </CardContent>
    </Card>
  );
}

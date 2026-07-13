"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api/client";
import { useQuotes } from "@/hooks/useQuotes";

// 시세 조정 적용 시간 선택지 (30분 단위, ""는 남은 시간 전체)
const DURATION_OPTIONS = [30, 60, 90, 120, 150, 180] as const;

export function EventSection() {
  const { data: quotes } = useQuotes();
  const queryClient = useQueryClient();
  const [cbMinutes, setCbMinutes] = useState("10");
  const [stock, setStock] = useState("OKJA");
  const [bias, setBias] = useState("-30");
  const [duration, setDuration] = useState("");

  async function circuitBreaker(minutes: number | null) {
    try {
      await postJson("/api/admin/circuit-breaker", { minutes });
      toast.success(minutes ? `서킷브레이커 ${minutes}분 발동` : "서킷브레이커 해제");
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    }
  }

  async function steerPrice() {
    try {
      const durationMinutes = duration === "" ? null : Number(duration);
      const result = await postJson<{ fromTick: number; replaced: number }>(
        "/api/admin/surprise",
        { stockCode: stock, bias: Number(bias), durationMinutes }
      );
      const range = durationMinutes ? `${durationMinutes}분간` : "남은 시간 전체";
      toast.success(
        `${stock} 시세 조정 (${range}, 틱 ${result.fromTick} 이후 ${result.replaced}개 재생성)`
      );
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
        <div className="flex flex-wrap gap-2">
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
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">남은 시간 전체</option>
            {DURATION_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}분
              </option>
            ))}
          </select>
          <Button onClick={steerPrice}>시세 조정</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          시세 조정은 지정 시간 동안 편향을 걸어 오늘 남은 경로를 다시 뽑습니다. 시간이
          지나면 중립 흐름으로 이어집니다 (장중에만 가능)
        </p>
      </CardContent>
    </Card>
  );
}

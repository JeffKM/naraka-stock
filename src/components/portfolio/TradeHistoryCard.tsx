"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/mascot/EmptyState";
import { getJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatMoney, formatQty } from "@/lib/market";
import type { Trade } from "@/types/domain";

interface TradePageDto {
  trades: Trade[];
  page: number;
  hasMore: boolean;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 거래내역 카드 (T-305): 페이지 누적 "더 보기" 방식 — 지갑 페이지에 상주
export function TradeHistoryCard() {
  const [pages, setPages] = useState(1);

  // 페이지별 쿼리를 누적 렌더 (간단한 무한 스크롤 대체)
  const queries = Array.from({ length: pages }, (_, i) => i + 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">거래내역</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border/60">
        {queries.map((page) => (
          <TradePageBlock
            key={page}
            page={page}
            isLast={page === pages}
            onMore={() => setPages((p) => p + 1)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function TradePageBlock({
  page,
  isLast,
  onMore,
}: {
  page: number;
  isLast: boolean;
  onMore: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["trades", page],
    queryFn: () => getJson<TradePageDto>(`/api/trades?page=${page}`),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 py-3">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <>
      {page === 1 && data.trades.length === 0 && (
        <EmptyState
          title="아직 거래 기록이 없어요."
          description="첫 거래를 기다리고 있어요."
        />
      )}
      {data.trades.map((t) => (
        <div key={t.id} className="flex items-center justify-between py-2.5">
          <div>
            <p className="font-medium">
              <Badge
                variant="outline"
                className={cn("mr-1.5", t.side === "buy" ? "text-bull" : "text-bear")}
              >
                {t.side === "buy" ? "매수" : "매도"}
              </Badge>
              {t.stockName}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatTime(t.createdAt)}</p>
          </div>
          <div className="text-right text-sm">
            <p>
              {formatQty(t.quantity)}주 × {formatMoney(t.price)}
            </p>
            {t.fee > 0 && (
              <p className="text-xs text-muted-foreground">수수료 {formatMoney(t.fee)}</p>
            )}
          </div>
        </div>
      ))}
      {isLast && data.hasMore && (
        <Button variant="ghost" className="my-2" onClick={onMore}>
          더 보기
        </Button>
      )}
    </>
  );
}

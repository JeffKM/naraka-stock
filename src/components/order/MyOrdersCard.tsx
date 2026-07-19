"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMyOrders } from "@/hooks/useMyOrders";
import { deleteJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatMoney, formatQty } from "@/lib/market";
import type { LimitOrder, OrderStatus } from "@/types/domain";

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "대기",
  filled: "체결",
  cancelled: "취소",
  expired: "만료",
};

// 예약 내용 요약: 매수는 금액, 매도는 수량
function reserveText(o: LimitOrder): string {
  return o.side === "buy"
    ? `${formatMoney(o.reservedCash ?? 0)}`
    : `${formatQty(o.reservedQty ?? 0)}주`;
}

function PendingRow({ order }: { order: LimitOrder }) {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await deleteJson(`/api/orders?id=${order.id}`);
      toast.success("예약 주문을 취소했어요");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "취소에 실패했습니다.");
    } finally {
      setCancelling(false);
    }
  }

  const isBuy = order.side === "buy";
  return (
    <div className="flex items-center justify-between rounded-lg px-2 py-2.5">
      <div>
        <p className="font-medium">
          {order.stockName}{" "}
          <span className={cn("text-sm font-bold", isBuy ? "text-bull" : "text-bear")}>
            {isBuy ? "매수" : "매도"}
          </span>
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          지정가 {formatMoney(order.limitPrice)} · 예약 {reserveText(order)}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={cancel} disabled={cancelling}>
        취소
      </Button>
    </div>
  );
}

function HistoryRow({ order }: { order: LimitOrder }) {
  const isBuy = order.side === "buy";
  const filled = order.status === "filled";
  return (
    <div className="flex items-center justify-between px-2 py-2 text-sm">
      <div>
        <span className="font-medium">{order.stockName}</span>{" "}
        <span className={cn("text-xs font-bold", isBuy ? "text-bull" : "text-bear")}>
          {isBuy ? "매수" : "매도"}
        </span>
        <p className="text-xs text-muted-foreground tabular-nums">
          지정가 {formatMoney(order.limitPrice)}
          {filled && order.filledQty != null && ` · ${formatQty(order.filledQty)}주 체결`}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
          filled ? "bg-primary/15 text-primary-accent" : "bg-muted text-muted-foreground"
        )}
      >
        {STATUS_LABEL[order.status]}
      </span>
    </div>
  );
}

// 지정가 예약주문 목록 (PRD §4.5). stockCode를 주면 그 종목 것만 필터(종목 상세용).
export function MyOrdersCard({ stockCode }: { stockCode?: string } = {}) {
  const { data, isError } = useMyOrders();

  // 비로그인·에러 시 숨김
  if (isError || !data) return null;

  const filter = (o: LimitOrder) => !stockCode || o.stockCode === stockCode;
  const pending = data.pending.filter(filter);
  const history = data.history.filter(filter).slice(0, 5);

  // 아무것도 없으면 카드 자체를 숨겨 화면을 비우지 않는다
  if (pending.length === 0 && history.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          지정가 예약주문{pending.length > 0 && ` (${pending.length})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {pending.map((o) => (
          <PendingRow key={o.id} order={o} />
        ))}
        {history.length > 0 && (
          <div className="mt-1 border-t pt-1">
            {history.map((o) => (
              <HistoryRow key={o.id} order={o} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

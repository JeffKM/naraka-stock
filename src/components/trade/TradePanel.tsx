"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getJson, postJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";
import type { Portfolio, StockQuote } from "@/types/domain";

const SELL_FEE_RATE = 0.003; // 표시용 (실제 수수료는 서버 계산)

interface TradePanelProps {
  quote: StockQuote;
  marketHalted?: boolean; // 서킷브레이커 발동 중
}

// 매수/매도 패널 (T-303) — 수량만 서버로 보낸다. 가격·수수료는 표시용 추정치.
export function TradePanel({ quote, marketHalted = false }: TradePanelProps) {
  const queryClient = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantityText, setQuantityText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 잔고·보유량 (비로그인이면 조용히 실패 — 패널은 로그인 유도만)
  const { data: portfolio } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => getJson<Portfolio>("/api/portfolio"),
    retry: false,
  });

  const quantity = Number(quantityText) || 0;
  const holdingQty =
    portfolio?.holdings.find((h) => h.stockCode === quote.code)?.quantity ?? 0;
  const maxQty =
    side === "buy" && quote.price > 0
      ? Math.floor((portfolio?.cash ?? 0) / quote.price)
      : holdingQty;
  const gross = quantity * quote.price;
  const fee = side === "sell" ? Math.floor(gross * SELL_FEE_RATE) : 0;

  async function submit() {
    if (quantity <= 0 || submitting) return;
    setSubmitting(true);
    try {
      const result = await postJson<{ price: number; fee: number; cash: number }>(
        "/api/trade",
        { stockCode: quote.code, side, quantity }
      );
      toast.success(
        side === "buy"
          ? `매수 체결! ${quantity}주 × ${formatMoney(result.price)}`
          : `매도 체결! ${quantity}주 × ${formatMoney(result.price)} (수수료 ${formatMoney(result.fee)})`
      );
      setQuantityText("");
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["trades"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "주문에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">주문 (시장가)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Tabs value={side} onValueChange={(v) => setSide(v as "buy" | "sell")}>
          <TabsList className="w-full">
            <TabsTrigger value="buy" className="flex-1 data-[state=active]:text-bull">
              매수
            </TabsTrigger>
            <TabsTrigger value="sell" className="flex-1 data-[state=active]:text-bear">
              매도
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="수량"
            value={quantityText}
            onChange={(e) => setQuantityText(e.target.value)}
          />
          <Button
            variant="outline"
            onClick={() => setQuantityText(String(maxQty))}
            disabled={maxQty <= 0}
          >
            최대
          </Button>
        </div>

        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">예상 체결액</span>
            <span>{formatMoney(gross)}</span>
          </div>
          {side === "sell" && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">수수료 (0.3%)</span>
              <span>-{formatMoney(fee)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t pt-1 font-medium">
            <span>{side === "buy" ? "필요 금액" : "수령 금액"}</span>
            <span>{formatMoney(side === "buy" ? gross : gross - fee)}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {side === "buy"
              ? `주문 가능: ${formatMoney(portfolio?.cash ?? 0)} (최대 ${maxQty}주)`
              : `보유: ${holdingQty}주`}
          </p>
        </div>

        <Button
          onClick={submit}
          disabled={
            quantity <= 0 || quantity > maxQty || submitting || quote.isHalted || marketHalted
          }
          className={side === "buy" ? "bg-bull hover:bg-bull/90" : "bg-bear hover:bg-bear/90"}
        >
          {marketHalted
            ? "서킷브레이커 발동 중"
            : quote.isHalted
              ? "거래 정지 중"
              : submitting
                ? "주문 중..."
                : side === "buy"
                  ? "매수"
                  : "매도"}
        </Button>
      </CardContent>
    </Card>
  );
}

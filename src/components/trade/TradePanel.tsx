"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TradeSuccessOverlay, type TradeSuccessInfo } from "@/components/trade/TradeSuccessOverlay";
import { getJson, postJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";
import { playTradeSound } from "@/lib/sound";
import type { Portfolio, StockQuote } from "@/types/domain";

const SELL_FEE_RATE = 0.003; // 표시용 (실제 수수료는 서버 계산)

interface TradePanelProps {
  quote: StockQuote;
  marketHalted?: boolean; // 서킷브레이커 발동 중
}

// 매수/매도 패널 (토스 벤치마킹 개편): 큰 구매/판매 버튼 → Dialog에서
// [금액·수량 입력 → 확인] 2탭이면 체결 완료 팝업이 뜬다.
// 서버에는 수량만 보낸다 — 가격·수수료는 표시용 추정치.
export function TradePanel({ quote, marketHalted = false }: TradePanelProps) {
  const [dialog, setDialog] = useState<"buy" | "sell" | null>(null);
  const [success, setSuccess] = useState<TradeSuccessInfo | null>(null);

  // 잔고·보유량 (비로그인이면 실패 → 로그인 유도)
  const { data: portfolio, isError } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => getJson<Portfolio>("/api/portfolio"),
    retry: false,
  });

  const blocked = marketHalted || quote.isHalted;
  const blockedLabel = marketHalted ? "서킷브레이커 발동 중" : "거래 정지 중";

  if (isError) {
    return (
      <Card>
        <CardContent className="py-3">
          <Button asChild className="w-full">
            <Link href="/login">로그인하고 거래하기</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="flex gap-2 py-3">
          <Button
            className="h-12 flex-1 bg-bull text-base font-bold text-white hover:bg-bull/90"
            disabled={blocked}
            onClick={() => setDialog("buy")}
          >
            {blocked ? blockedLabel : "구매하기"}
          </Button>
          <Button
            className="h-12 flex-1 bg-bear text-base font-bold text-white hover:bg-bear/90"
            disabled={blocked}
            onClick={() => setDialog("sell")}
          >
            {blocked ? blockedLabel : "판매하기"}
          </Button>
        </CardContent>
      </Card>

      <BuyDialog
        open={dialog === "buy"}
        onOpenChange={(open) => setDialog(open ? "buy" : null)}
        quote={quote}
        cash={portfolio?.cash ?? 0}
        onSuccess={setSuccess}
      />
      <SellDialog
        open={dialog === "sell"}
        onOpenChange={(open) => setDialog(open ? "sell" : null)}
        quote={quote}
        holdingQty={
          portfolio?.holdings.find((h) => h.stockCode === quote.code)?.quantity ?? 0
        }
        onSuccess={setSuccess}
      />

      <TradeSuccessOverlay info={success} onClose={() => setSuccess(null)} />
    </>
  );
}

interface TradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: StockQuote;
  onSuccess: (info: TradeSuccessInfo) => void;
}

// 주문 공통 제출 훅 역할 — 체결되면 다이얼로그를 닫고 성공 팝업을 띄운다
function useSubmitTrade(
  quote: StockQuote,
  side: "buy" | "sell",
  onOpenChange: (open: boolean) => void,
  onSuccess: (info: TradeSuccessInfo) => void
) {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  async function submit(quantity: number, reset: () => void) {
    if (quantity <= 0 || submitting) return;
    setSubmitting(true);
    try {
      const result = await postJson<{ price: number; fee: number; cash: number }>(
        "/api/trade",
        { stockCode: quote.code, side, quantity }
      );
      onOpenChange(false);
      reset();
      onSuccess({ side, stockName: quote.name, quantity, price: result.price });
      playTradeSound(); // 체결 효과음 (볼륨은 설정 모달에서 조절)
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      queryClient.invalidateQueries({ queryKey: ["popular"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "주문에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return { submit, submitting };
}

const BUY_CHIPS = [10_000, 50_000, 100_000] as const;

// 구매: 얼마치 살까요? — 금액을 넣으면 수량으로 환산해 시장가 체결
function BuyDialog({
  open,
  onOpenChange,
  quote,
  cash,
  onSuccess,
}: TradeDialogProps & { cash: number }) {
  const [amountText, setAmountText] = useState("");
  const { submit, submitting } = useSubmitTrade(quote, "buy", onOpenChange, onSuccess);

  const amount = Number(amountText) || 0;
  const quantity = quote.price > 0 ? Math.floor(amount / quote.price) : 0;
  const maxQty = quote.price > 0 ? Math.floor(cash / quote.price) : 0;
  const cost = quantity * quote.price;
  const valid = quantity >= 1 && quantity <= maxQty;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>얼마치 살까요?</DialogTitle>
          <DialogDescription>
            {quote.name} · 1주 {formatMoney(quote.price)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="금액 (원)"
            value={amountText}
            autoFocus
            onChange={(e) => setAmountText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && valid && submit(quantity, () => setAmountText(""))}
            className="h-12 text-lg font-semibold"
          />
          <div className="flex gap-1.5">
            {BUY_CHIPS.map((chip) => (
              <Button
                key={chip}
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setAmountText(String(amount + chip))}
              >
                +{chip / 10_000}만
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={maxQty <= 0}
              onClick={() => setAmountText(String(maxQty * quote.price))}
            >
              최대
            </Button>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">예상 수량</span>
              <span className="font-medium">{quantity.toLocaleString("ko-KR")}주</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">필요 금액</span>
              <span className="font-medium">{formatMoney(cost)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              주문 가능 {formatMoney(cash)}
              {amount > 0 && quantity === 0 && " · 1주 금액보다 적어요"}
            </p>
          </div>

          <Button
            className="h-12 bg-bull text-base font-bold text-white hover:bg-bull/90"
            disabled={!valid || submitting}
            onClick={() => submit(quantity, () => setAmountText(""))}
          >
            {submitting ? "주문 중..." : quantity >= 1 ? `${quantity}주 구매 확인` : "구매 확인"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SELL_CHIPS = [
  { label: "10%", ratio: 0.1 },
  { label: "25%", ratio: 0.25 },
  { label: "50%", ratio: 0.5 },
  { label: "전량", ratio: 1 },
] as const;

// 판매: 몇 주 팔까요? — 수량 입력 + 비율 칩
function SellDialog({
  open,
  onOpenChange,
  quote,
  holdingQty,
  onSuccess,
}: TradeDialogProps & { holdingQty: number }) {
  const [quantityText, setQuantityText] = useState("");
  const { submit, submitting } = useSubmitTrade(quote, "sell", onOpenChange, onSuccess);

  const quantity = Number(quantityText) || 0;
  const gross = quantity * quote.price;
  const fee = Math.floor(gross * SELL_FEE_RATE);
  const valid = quantity >= 1 && quantity <= holdingQty;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>몇 주 팔까요?</DialogTitle>
          <DialogDescription>
            {quote.name} · 1주 {formatMoney(quote.price)} · 보유{" "}
            {holdingQty.toLocaleString("ko-KR")}주
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="수량 (주)"
            value={quantityText}
            autoFocus
            onChange={(e) => setQuantityText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && valid && submit(quantity, () => setQuantityText(""))}
            className="h-12 text-lg font-semibold"
          />
          <div className="flex gap-1.5">
            {SELL_CHIPS.map((chip) => (
              <Button
                key={chip.label}
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={holdingQty <= 0}
                onClick={() => setQuantityText(String(Math.max(1, Math.floor(holdingQty * chip.ratio))))}
              >
                {chip.label}
              </Button>
            ))}
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">예상 체결액</span>
              <span className="font-medium">{formatMoney(gross)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">수수료 (0.3%)</span>
              <span className="font-medium">-{formatMoney(fee)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 font-medium">
              <span>수령 금액</span>
              <span>{formatMoney(gross - fee)}</span>
            </div>
          </div>

          <Button
            className="h-12 bg-bear text-base font-bold text-white hover:bg-bear/90"
            disabled={!valid || submitting}
            onClick={() => submit(quantity, () => setQuantityText(""))}
          >
            {submitting ? "주문 중..." : quantity >= 1 ? `${quantity}주 판매 확인` : "판매 확인"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

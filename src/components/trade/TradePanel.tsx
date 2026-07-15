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
import { cn } from "@/lib/utils";
import { formatMoney, formatQty } from "@/lib/market";
import { playTradeSound } from "@/lib/sound";
import type { Portfolio, StockQuote } from "@/types/domain";

const SELL_FEE_RATE = 0.005; // 표시용 (실제 수수료는 서버 계산)

type OrderType = "market" | "limit";

interface TradePanelProps {
  quote: StockQuote;
  marketHalted?: boolean; // 서킷브레이커 발동 중
}

// 매수/매도 패널 (토스 벤치마킹 개편): 큰 구매/판매 버튼 → Dialog에서
// [시장가/지정가] × [금액·수량 입력] → 확인. 지정가는 예약주문(§4.5).
// 서버에는 수량/금액과 지정가만 보낸다 — 체결가·수수료·밴드 판정은 전부 서버.
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

  const holding = portfolio?.holdings.find((h) => h.stockCode === quote.code);

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
        availableCash={portfolio?.availableCash ?? 0}
        onSuccess={setSuccess}
      />
      <SellDialog
        open={dialog === "sell"}
        onOpenChange={(open) => setDialog(open ? "sell" : null)}
        quote={quote}
        holdingQty={holding?.quantity ?? 0}
        availableQty={holding?.availableQty ?? 0}
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

// 서버로 보내는 시장가 주문 페이로드 — 금액(매수·매도 금액모드) 또는 수량(매도 수량모드)
type TradePayload = { amount: number } | { quantity: number };

// 시장가 주문 제출 훅 — 체결되면 다이얼로그를 닫고 성공 팝업을 띄운다.
function useSubmitTrade(
  quote: StockQuote,
  side: "buy" | "sell",
  onOpenChange: (open: boolean) => void,
  onSuccess: (info: TradeSuccessInfo) => void
) {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  async function submit(payload: TradePayload, estQty: number, reset: () => void) {
    if (estQty <= 0 || submitting) return;
    setSubmitting(true);
    try {
      const result = await postJson<{ price: number; fee: number; cash: number; quantity: number }>(
        "/api/trade",
        { stockCode: quote.code, side, ...payload }
      );
      onOpenChange(false);
      reset();
      onSuccess({ side, stockName: quote.name, quantity: result.quantity, price: result.price });
      playTradeSound();
      invalidateAll(queryClient);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "주문에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return { submit, submitting };
}

// 지정가 주문 페이로드 — 매수는 금액, 매도는 수량. 지정가(limitPrice) 필수.
type OrderPayload = { limitPrice: number } & ({ amount: number } | { quantity: number });

// 지정가 접수 훅 — 즉시 충족이면 서버가 시장가로 체결(immediate=true), 아니면 예약.
function useSubmitOrder(
  quote: StockQuote,
  side: "buy" | "sell",
  onOpenChange: (open: boolean) => void,
  onSuccess: (info: TradeSuccessInfo) => void
) {
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  async function submit(payload: OrderPayload, reset: () => void) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await postJson<{
        immediate: boolean;
        price?: number;
        quantity?: number;
      }>("/api/orders", { stockCode: quote.code, side, ...payload });
      onOpenChange(false);
      reset();
      if (result.immediate && result.price && result.quantity) {
        // 조건이 이미 충족돼 즉시 시장가로 체결됨
        onSuccess({ side, stockName: quote.name, quantity: result.quantity, price: result.price });
        playTradeSound();
      } else {
        toast.success(
          `${quote.name} ${side === "buy" ? "매수" : "매도"} 지정가 ${formatMoney(
            payload.limitPrice
          )} 예약됐어요`
        );
      }
      invalidateAll(queryClient);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "주문에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return { submit, submitting };
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["portfolio"] });
  queryClient.invalidateQueries({ queryKey: ["me"] });
  queryClient.invalidateQueries({ queryKey: ["trades"] });
  queryClient.invalidateQueries({ queryKey: ["popular"] });
}

// 시장가/지정가 선택 토글 (다이얼로그 상단 공통)
function OrderTypeTabs({
  value,
  onChange,
}: {
  value: OrderType;
  onChange: (v: OrderType) => void;
}) {
  return (
    <div className="flex gap-1.5">
      <Button
        size="sm"
        variant={value === "market" ? "default" : "outline"}
        className="flex-1"
        onClick={() => onChange("market")}
      >
        시장가
      </Button>
      <Button
        size="sm"
        variant={value === "limit" ? "default" : "outline"}
        className="flex-1"
        onClick={() => onChange("limit")}
      >
        지정가
      </Button>
    </div>
  );
}

// 지정가 입력 + 밴드 범위 안내 (매수/매도 공용)
function LimitPriceInput({
  quote,
  side,
  value,
  onChange,
}: {
  quote: StockQuote;
  side: "buy" | "sell";
  value: string;
  onChange: (v: string) => void;
}) {
  const price = Math.floor(Number(value) || 0);
  const outOfBand =
    price > 0 && (price > quote.upperLimit || price < quote.lowerLimit);
  // 대기 방향 반대(이미 충족)면 즉시 시장가 체결됨을 안내
  const immediate =
    price > 0 &&
    !outOfBand &&
    (side === "buy" ? price >= quote.price : price <= quote.price);
  // 현재가 기준 나눔 칩: 매수는 아래로, 매도는 위로
  const nudges = side === "buy" ? [-1, -3, -5] : [1, 3, 5];

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        placeholder="지정가 (원)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 text-base font-semibold"
      />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => onChange(String(quote.price))}
        >
          현재가
        </Button>
        {nudges.map((pct) => (
          <Button
            key={pct}
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => onChange(String(Math.round((quote.price * (100 + pct)) / 100)))}
          >
            {pct > 0 ? "+" : ""}
            {pct}%
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        가능 범위 {formatMoney(quote.lowerLimit)} ~ {formatMoney(quote.upperLimit)}
      </p>
      {outOfBand && (
        <p className="text-xs text-bear">상하한가(±30%) 범위를 벗어났어요</p>
      )}
      {immediate && (
        <p className="text-xs text-primary-accent">현재가 조건이 충족돼 즉시 시장가로 체결돼요</p>
      )}
    </div>
  );
}

const BUY_CHIPS = [10_000, 50_000, 100_000] as const;

// 구매: 시장가(금액→소수점 즉시 체결) / 지정가(금액 예약, 조건 도달 시 지정가로 체결)
function BuyDialog({
  open,
  onOpenChange,
  quote,
  availableCash,
  onSuccess,
}: TradeDialogProps & { availableCash: number }) {
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [amountText, setAmountText] = useState("");
  const [limitText, setLimitText] = useState("");
  const market = useSubmitTrade(quote, "buy", onOpenChange, onSuccess);
  const order = useSubmitOrder(quote, "buy", onOpenChange, onSuccess);

  const amount = Math.floor(Number(amountText) || 0);
  const limitPrice = Math.floor(Number(limitText) || 0);
  const isLimit = orderType === "limit";
  // 지정가면 예상 수량은 지정가 기준, 시장가면 현재가 기준
  const unit = isLimit && limitPrice > 0 ? limitPrice : quote.price;
  const quantity = unit > 0 ? amount / unit : 0;

  const bandOk = limitPrice > 0 && limitPrice <= quote.upperLimit && limitPrice >= quote.lowerLimit;
  const valid =
    amount >= 1 && amount <= availableCash && (isLimit ? bandOk : true);

  function reset() {
    setAmountText("");
    setLimitText("");
  }

  function onSubmit() {
    if (!valid) return;
    if (isLimit) order.submit({ limitPrice, amount }, reset);
    else market.submit({ amount }, quantity, () => setAmountText(""));
  }

  const submitting = isLimit ? order.submitting : market.submitting;

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
          <OrderTypeTabs value={orderType} onChange={setOrderType} />

          {isLimit && (
            <LimitPriceInput quote={quote} side="buy" value={limitText} onChange={setLimitText} />
          )}

          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="금액 (원)"
            value={amountText}
            autoFocus={!isLimit}
            onChange={(e) => setAmountText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
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
              disabled={availableCash <= 0}
              onClick={() => setAmountText(String(availableCash))}
            >
              최대
            </Button>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">예상 수량</span>
              <span className="font-medium">{formatQty(quantity)}주</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">주문 금액</span>
              <span className="font-medium">{formatMoney(amount)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              주문 가능 {formatMoney(availableCash)}
              {amount > availableCash && " · 잔고를 초과했어요"}
            </p>
          </div>

          <Button
            className="h-12 bg-bull text-base font-bold text-white hover:bg-bull/90"
            disabled={!valid || submitting}
            onClick={onSubmit}
          >
            {submitting
              ? "주문 중..."
              : isLimit
                ? "지정가 매수 예약"
                : quantity > 0
                  ? `${formatQty(quantity)}주 구매 확인`
                  : "구매 확인"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SELL_RATIOS = [
  { label: "25%", ratio: 0.25 },
  { label: "50%", ratio: 0.5 },
  { label: "전량", ratio: 1 },
] as const;

// 6자리로 절사 (서버 절사 규칙과 일치 — 표시·전송 값 불일치 방지)
function truncQty(q: number): number {
  return Math.floor(q * 1_000_000) / 1_000_000;
}

// 판매: 시장가(수량/금액) / 지정가(수량 예약). 매도 가능 수량은 예약분을 뺀 availableQty.
function SellDialog({
  open,
  onOpenChange,
  quote,
  holdingQty,
  availableQty,
  onSuccess,
}: TradeDialogProps & { holdingQty: number; availableQty: number }) {
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [mode, setMode] = useState<"qty" | "amount">("qty");
  const [text, setText] = useState("");
  const [limitText, setLimitText] = useState("");
  const market = useSubmitTrade(quote, "sell", onOpenChange, onSuccess);
  const order = useSubmitOrder(quote, "sell", onOpenChange, onSuccess);

  const isLimit = orderType === "limit";
  const reserved = holdingQty - availableQty; // 다른 지정가로 예약 중인 수량
  const input = Number(text) || 0;
  const limitPrice = Math.floor(Number(limitText) || 0);

  // 지정가는 수량 기준만. 시장가는 수량/금액 토글.
  const rawQty =
    isLimit || mode === "qty" ? input : quote.price > 0 ? input / quote.price : 0;
  const sellQty = Math.min(truncQty(rawQty), availableQty);
  const unit = isLimit && limitPrice > 0 ? limitPrice : quote.price;
  const gross = Math.round(sellQty * unit);
  const fee = Math.floor(gross * SELL_FEE_RATE);

  const bandOk = limitPrice > 0 && limitPrice <= quote.upperLimit && limitPrice >= quote.lowerLimit;
  const valid =
    sellQty > 0 &&
    (isLimit
      ? bandOk && input <= availableQty + 1e-6
      : mode === "qty"
        ? input <= availableQty + 1e-6
        : input >= 1);

  function reset() {
    setText("");
    setLimitText("");
  }

  function onSubmit() {
    if (!valid) return;
    if (isLimit) {
      order.submit({ limitPrice, quantity: sellQty }, reset);
    } else {
      const payload: TradePayload = mode === "qty" ? { quantity: sellQty } : { amount: Math.floor(input) };
      market.submit(payload, sellQty, () => setText(""));
    }
  }

  const submitting = isLimit ? order.submitting : market.submitting;
  // 비율 칩은 매도 가능 수량 기준 (예약분 제외)
  const ratioBase = availableQty;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>얼마나 팔까요?</DialogTitle>
          <DialogDescription>
            {quote.name} · 1주 {formatMoney(quote.price)} · 보유 {formatQty(holdingQty)}주
            {reserved > 1e-6 && ` (예약 ${formatQty(reserved)}주 제외)`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <OrderTypeTabs value={orderType} onChange={setOrderType} />

          {isLimit && (
            <LimitPriceInput quote={quote} side="sell" value={limitText} onChange={setLimitText} />
          )}

          {/* 시장가 수량/금액 토글 (지정가는 수량 기준만) */}
          {!isLimit && (
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant={mode === "qty" ? "default" : "outline"}
                className="flex-1"
                onClick={() => {
                  setMode("qty");
                  setText("");
                }}
              >
                수량
              </Button>
              <Button
                size="sm"
                variant={mode === "amount" ? "default" : "outline"}
                className="flex-1"
                onClick={() => {
                  setMode("amount");
                  setText("");
                }}
              >
                금액
              </Button>
            </div>
          )}

          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder={!isLimit && mode === "amount" ? "금액 (원)" : "수량 (주)"}
            value={text}
            autoFocus={!isLimit}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            className="h-12 text-lg font-semibold"
          />
          <div className="flex gap-1.5">
            {SELL_RATIOS.map((chip) => (
              <Button
                key={chip.label}
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={ratioBase <= 0}
                onClick={() =>
                  setText(
                    !isLimit && mode === "amount"
                      ? String(Math.floor(ratioBase * quote.price * chip.ratio))
                      : String(chip.ratio === 1 ? ratioBase : truncQty(ratioBase * chip.ratio))
                  )
                }
              >
                {chip.label}
              </Button>
            ))}
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">예상 수량</span>
              <span className="font-medium">{formatQty(sellQty)}주</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">예상 체결액</span>
              <span className="font-medium">{formatMoney(gross)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">수수료 (0.5%)</span>
              <span className="font-medium">-{formatMoney(fee)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 font-medium">
              <span>수령 금액</span>
              <span>{formatMoney(gross - fee)}</span>
            </div>
          </div>

          <Button
            className={cn(
              "h-12 text-base font-bold text-white",
              "bg-bear hover:bg-bear/90"
            )}
            disabled={!valid || submitting}
            onClick={onSubmit}
          >
            {submitting
              ? "주문 중..."
              : isLimit
                ? "지정가 매도 예약"
                : sellQty > 0
                  ? `${formatQty(sellQty)}주 판매 확인`
                  : "판매 확인"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

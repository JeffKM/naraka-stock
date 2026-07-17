"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TradeHistoryCard } from "@/components/portfolio/TradeHistoryCard";
import { MyOrdersCard } from "@/components/order/MyOrdersCard";
import { LiveTotalAssets } from "@/components/quotes/LiveTotalAssets";
import { usePriceWiggle } from "@/hooks/usePriceWiggle";
import { useQuotes } from "@/hooks/useQuotes";
import { getJson, postJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatMoney, formatQty } from "@/lib/market";
import type { Me, Portfolio } from "@/types/domain";

// 보유 종목 한 줄 — 장중엔 평가액이 미세 진동 (표시용, 시세판과 동일 연출)
function HoldingRow({ holding: h }: { holding: Portfolio["holdings"][number] }) {
  const { data: quotesData } = useQuotes();
  const liveValue = usePriceWiggle(h.value, quotesData?.marketState === "open");
  const livePnl = h.pnl + (liveValue - h.value); // 평가액 진동만큼 손익도 함께
  const cost = Math.round(h.quantity * h.avgPrice);
  const livePnlPercent = cost > 0 ? Math.round((livePnl / cost) * 10000) / 100 : 0;
  return (
    <Link
      href={`/stocks/${h.stockCode}`}
      className="flex items-center justify-between rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50"
    >
      <div>
        <p className="font-medium">{h.stockName}</p>
        <p className="text-xs text-muted-foreground">
          {formatQty(h.quantity)}주 · 평단 {formatMoney(h.avgPrice)}
        </p>
      </div>
      <div className="text-right">
        <p className="font-medium tabular-nums">{formatMoney(liveValue)}</p>
        <p
          className={cn(
            "text-xs tabular-nums",
            livePnl > 0 && "text-bull",
            livePnl < 0 && "text-bear"
          )}
        >
          {livePnl >= 0 ? "+" : ""}
          {formatMoney(livePnl)} ({livePnlPercent >= 0 ? "+" : ""}
          {livePnlPercent}%)
        </p>
      </div>
    </Link>
  );
}

// 내 지갑 (T-304): 총자산·현금·보유 종목 평가 + 방문 보너스 + 로그아웃
export default function PortfolioPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [bonusCode, setBonusCode] = useState("");
  const [claiming, setClaiming] = useState(false);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => getJson<Me>("/api/auth/me"),
  });
  const { data: portfolio, isLoading } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => getJson<Portfolio>("/api/portfolio"),
    refetchInterval: 60_000,
  });

  const totalPnl = portfolio
    ? portfolio.holdings.reduce((sum, h) => sum + h.pnl, 0)
    : 0;

  async function claimBonus() {
    if (!bonusCode.trim() || claiming) return;
    setClaiming(true);
    try {
      const { cash } = await postJson<{ cash: number }>("/api/bonus", { code: bonusCode });
      toast.success(`방문 보너스 +1,000,000원! 잔고 ${formatMoney(cash)}`);
      setBonusCode("");
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "보너스 수령에 실패했습니다.");
    } finally {
      setClaiming(false);
    }
  }

  async function logout() {
    await postJson("/api/auth/logout");
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">내 지갑</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {me ? `${me.nickname}님의 총자산` : <Skeleton className="h-5 w-24" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !portfolio ? (
            <Skeleton className="h-8 w-40" />
          ) : (
            <>
              <LiveTotalAssets
                cash={portfolio.cash}
                totalAssets={portfolio.totalAssets}
                className="text-2xl font-bold"
              />
              <div className="mt-2 flex justify-between text-sm text-muted-foreground">
                <span>현금 {formatMoney(portfolio.cash)}</span>
                <span
                  className={cn(totalPnl > 0 && "text-bull", totalPnl < 0 && "text-bear")}
                >
                  평가손익 {totalPnl >= 0 ? "+" : ""}
                  {formatMoney(totalPnl)}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">보유 종목</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {portfolio && portfolio.holdings.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              아직 보유한 주식이 없습니다
              <br />
              시세판에서 첫 주식을 사보세요!
            </p>
          )}
          {portfolio?.holdings.map((h) => (
            <HoldingRow key={h.stockCode} holding={h} />
          ))}
        </CardContent>
      </Card>

      <MyOrdersCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">매장 방문 보너스</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            매장에 게시된 오늘의 코드를 입력하면 +1,000,000원 (1일 1회)
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="오늘의 방문 코드"
              value={bonusCode}
              onChange={(e) => setBonusCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && claimBonus()}
            />
            <Button onClick={claimBonus} disabled={claiming || !bonusCode.trim()}>
              받기
            </Button>
          </div>
        </CardContent>
      </Card>

      <TradeHistoryCard />

      <Button variant="outline" onClick={logout}>
        로그아웃
      </Button>
    </div>
  );
}

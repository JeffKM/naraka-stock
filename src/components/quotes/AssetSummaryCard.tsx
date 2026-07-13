"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";
import { cn } from "@/lib/utils";
import type { Portfolio } from "@/types/domain";

// 내 자산 요약 카드 (Phase 8, 토스 홈 "내 계좌" 벤치마킹)
// 탭하면 지갑으로 이동. 비로그인이면 로그인 유도로 대체.
export function AssetSummaryCard() {
  const { data: portfolio, isLoading, isError } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => getJson<Portfolio>("/api/portfolio"),
    retry: false,
  });

  if (isLoading) return null;

  if (isError || !portfolio) {
    return (
      <Link href="/login">
        <Card className="transition-colors hover:bg-muted/40">
          <CardContent className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">로그인하고 거래를 시작하세요</p>
              <p className="text-xs text-muted-foreground">매장 가입 코드로 100만원 지급 👻</p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>
    );
  }

  // 평가손익 = 보유 종목 미실현 손익 합 (표시용 — 실제 정산은 서버)
  const pnl = portfolio.holdings.reduce((sum, h) => sum + h.pnl, 0);
  const cost = portfolio.holdings.reduce((sum, h) => sum + h.quantity * h.avgPrice, 0);
  const pnlPercent = cost > 0 ? Math.round((pnl / cost) * 10000) / 100 : 0;
  const up = pnl > 0;
  const down = pnl < 0;

  return (
    <Link href="/portfolio">
      <Card className="transition-colors hover:bg-muted/40">
        <CardContent className="flex items-center justify-between py-3">
          <div>
            <p className="text-xs text-muted-foreground">내 투자</p>
            <p className="text-lg font-bold leading-tight tabular-nums">
              {formatMoney(portfolio.totalAssets)}
            </p>
            <p
              className={cn(
                "text-xs tabular-nums",
                up && "text-bull",
                down && "text-bear",
                !up && !down && "text-muted-foreground"
              )}
            >
              평가손익 {up ? "+" : ""}
              {formatMoney(pnl)}
              {cost > 0 ? ` (${pnlPercent > 0 ? "+" : ""}${pnlPercent}%)` : ""}
            </p>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { useQuotes } from "@/hooks/useQuotes";
import { getJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/market";

interface PopularStock {
  rank: number;
  code: string;
  name: string;
  tradeCount: number;
}

// 실시간 인기 종목 (토스 벤치마킹): 최근 10분간 체결이 많은 종목 1~5위.
// 거래가 없으면 섹션 자체를 숨긴다.
export function PopularStocks() {
  const { data: quotesData } = useQuotes();
  const { data } = useQuery({
    queryKey: ["popular"],
    queryFn: () => getJson<{ stocks: PopularStock[] }>("/api/popular"),
    refetchInterval: 60_000,
  });

  if (!data || data.stocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        실시간 인기
        <span className="text-xs font-normal text-muted-foreground">최근 10분 거래 많은 순</span>
      </h2>
      <Card>
        <CardContent className="flex flex-col divide-y divide-border/60 py-1">
          {data.stocks.map((s) => {
            const quote = quotesData?.quotes.find((q) => q.code === s.code);
            const up = (quote?.change ?? 0) > 0;
            const down = (quote?.change ?? 0) < 0;
            return (
              <Link
                key={s.code}
                href={`/stocks/${s.code}`}
                className="flex items-center justify-between py-2.5 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "w-4 text-center text-sm font-bold tabular-nums",
                      s.rank === 1 ? "text-bull" : "text-muted-foreground"
                    )}
                  >
                    {s.rank}
                  </span>
                  <div>
                    <p className="font-medium leading-tight">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.tradeCount.toLocaleString("ko-KR")}건 체결
                    </p>
                  </div>
                </div>
                {quote && (
                  <div className="text-right">
                    <p
                      className={cn(
                        "text-sm font-semibold leading-tight",
                        up && "text-bull",
                        down && "text-bear"
                      )}
                    >
                      {formatMoney(quote.price)}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        up && "text-bull",
                        down && "text-bear",
                        !up && !down && "text-muted-foreground"
                      )}
                    >
                      {quote.changePercent > 0 ? "+" : ""}
                      {quote.changePercent}%
                    </p>
                  </div>
                )}
              </Link>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

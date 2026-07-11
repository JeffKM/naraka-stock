"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/quotes/Sparkline";
import { useQuotes } from "@/hooks/useQuotes";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/market";

const TIER_LABEL = { stable: "우량주", normal: "일반주", wild: "테마주" } as const;

// 시세판 홈 (T-401): 전 종목 전광판
export default function Home() {
  const { data, isLoading } = useQuotes();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">시세판</h1>
        {data?.marketState === "holiday" && (
          <span className="text-sm text-muted-foreground">오늘은 휴장일입니다 🌙</span>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col divide-y divide-border/60 py-2">
          {isLoading &&
            Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center justify-between py-3">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          {data?.quotes.map((q) => {
            const up = q.change > 0;
            const down = q.change < 0;
            return (
              <Link
                key={q.code}
                href={`/stocks/${q.code}`}
                className="flex items-center justify-between py-3 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center gap-2">
                  <div>
                    <p className="font-medium leading-tight">{q.name}</p>
                    <p className="text-xs text-muted-foreground">{TIER_LABEL[q.tier]}</p>
                  </div>
                  {q.isUpperLimit && <Badge className="bg-bull px-1.5 text-xs">上</Badge>}
                  {q.isLowerLimit && <Badge className="bg-bear px-1.5 text-xs">下</Badge>}
                  {q.isHalted && (
                    <Badge variant="destructive" className="px-1.5 text-xs">
                      VI
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Sparkline points={q.spark} positive={up} neutral={!up && !down} />
                  <div className="text-right">
                    <p
                      className={cn(
                        "font-semibold leading-tight",
                        up && "text-bull",
                        down && "text-bear"
                      )}
                    >
                      {formatMoney(q.price)}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        up && "text-bull",
                        down && "text-bear",
                        !up && !down && "text-muted-foreground"
                      )}
                    >
                      {up ? "▲" : down ? "▼" : "―"} {q.changePercent > 0 ? "+" : ""}
                      {q.changePercent}%
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        시세는 5분마다 갱신됩니다 · 장 시간 수~일 15:00~22:00
      </p>
    </div>
  );
}

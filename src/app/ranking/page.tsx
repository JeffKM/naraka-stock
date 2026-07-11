"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/market";
import type { RankingEntry } from "@/types/domain";

interface RankingDto {
  top: RankingEntry[];
  me: RankingEntry | null;
  totalUsers: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

// 랭킹 (T-601): 상위 20명 + 내 등수 하단 고정
export default function RankingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["ranking"],
    queryFn: () => getJson<RankingDto>("/api/ranking"),
    refetchInterval: 60_000,
  });

  return (
    <div className="flex flex-col gap-4 pb-16">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">랭킹</h1>
        {data && (
          <span className="text-sm text-muted-foreground">참가자 {data.totalUsers}명</span>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col divide-y divide-border/60 py-1">
          {isLoading &&
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="py-3">
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          {data?.top.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              아직 참가자가 없습니다 👻
            </p>
          )}
          {data?.top.map((entry) => (
            <RankingRow key={entry.rank} entry={entry} highlight={entry.rank === data.me?.rank} />
          ))}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        최종 순위는 8/30(일) 22:00 종가 기준으로 확정됩니다 · 상위 4명 상품 지급
      </p>

      {/* 내 등수 고정 표시 */}
      {data?.me && (
        <div className="fixed inset-x-0 bottom-[64px] z-30 mx-auto w-full max-w-lg px-4">
          <div className="rounded-xl border border-primary/40 bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur">
            <RankingRow entry={data.me} highlight />
          </div>
        </div>
      )}
    </div>
  );
}

function RankingRow({ entry, highlight = false }: { entry: RankingEntry; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-3">
        <span className="w-8 text-center font-bold">
          {MEDALS[entry.rank - 1] ?? entry.rank}
        </span>
        <span className={cn("font-medium", highlight && "text-primary")}>{entry.nickname}</span>
      </div>
      <span className="tabular-nums">{formatMoney(entry.totalAssets)}</span>
    </div>
  );
}

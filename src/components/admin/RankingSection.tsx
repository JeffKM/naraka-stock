"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeChip } from "@/components/badges/BadgeChip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";
import type { WeeklyBadge } from "@/types/domain";

// 총자산 랭킹 (운영자 전용 — 순위는 매장에서 발표)
export function RankingSection() {
  const { data } = useQuery({
    queryKey: ["admin-ranking"],
    queryFn: () =>
      getJson<{
        top: Array<{
          rank: number;
          nickname: string;
          totalAssets: number;
          representativeBadge: WeeklyBadge | null;
        }>;
        totalUsers: number;
      }>("/api/ranking"),
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          랭킹{" "}
          <span className="text-sm font-normal text-muted-foreground">
            참가자 {data?.totalUsers ?? "—"}명
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border/60">
        {data?.top.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">아직 참가자가 없습니다</p>
        )}
        {data?.top.map((entry) => (
          <div key={entry.rank} className="flex items-center justify-between py-2">
            <span>
              <span className="mr-2 inline-block w-7 text-center font-bold">
                {entry.rank}
              </span>
              {entry.nickname}
              {entry.representativeBadge && (
                <>
                  {" "}
                  <BadgeChip badge={entry.representativeBadge} />
                </>
              )}
            </span>
            <span className="tabular-nums text-sm">{formatMoney(entry.totalAssets)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

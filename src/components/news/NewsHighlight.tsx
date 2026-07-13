"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { NewsPageDto } from "@/components/news/NewsList";
import type { NewsGrade } from "@/types/domain";

const GRADE_META: Record<NewsGrade, { label: string; className: string }> = {
  disclosure: { label: "공시", className: "bg-secondary text-secondary-foreground" },
  news: { label: "뉴스", className: "bg-primary text-primary-foreground" },
  rumor: { label: "찌라시", className: "border border-border bg-transparent text-muted-foreground" },
};

// 등급 우선순위: 공시 > 정식 뉴스 > 찌라시 (신뢰도 순)
const GRADE_ORDER: Record<NewsGrade, number> = { disclosure: 0, news: 1, rumor: 2 };

// 홈 뉴스 하이라이트 (Phase 8): 최신 뉴스 중 공시 우선 2건, 탭하면 뉴스 탭으로
export function NewsHighlight() {
  const { data, isLoading } = useQuery({
    queryKey: ["news", "all", 1],
    queryFn: () => getJson<NewsPageDto>("/api/news?page=1"),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-3">
          <Skeleton className="h-4 w-20" />
          <div className="mt-2 flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.items.length === 0) return null;

  const latestDate = data.items[0].date;
  const highlights = data.items
    .filter((n) => n.date === latestDate)
    .sort((a, b) => GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade])
    .slice(0, 2);

  return (
    <Link href="/news">
      <Card className="transition-colors hover:bg-muted/40">
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">오늘의 소식</h2>
            <ChevronRight className="size-4 text-muted-foreground" />
          </div>
          <div className="mt-1 flex flex-col gap-1.5">
            {highlights.map((n) => (
              <div key={n.id} className="flex items-center gap-2">
                <Badge
                  className={cn("shrink-0 px-1.5 text-[11px]", GRADE_META[n.grade].className)}
                >
                  {GRADE_META[n.grade].label}
                </Badge>
                <p className="truncate text-sm">{n.title}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

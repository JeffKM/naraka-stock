"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getJson } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { NewsGrade, NewsItem } from "@/types/domain";

export interface NewsPageDto {
  items: NewsItem[];
  page: number;
  hasMore: boolean;
}

const GRADE_META: Record<NewsGrade, { label: string; className: string }> = {
  disclosure: { label: "공시", className: "bg-secondary text-secondary-foreground" },
  news: { label: "뉴스", className: "bg-primary text-primary-foreground" },
  rumor: { label: "찌라시", className: "border border-border bg-transparent text-muted-foreground" },
};

function formatDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// 뉴스 목록 (T-503/504 공용) — stock 지정 시 해당 종목만
// isLast + onMore: 페이지 누적 방식에서 마지막 블록이 "더 보기" 버튼을 담당
export function NewsList({
  stock,
  page = 1,
  compact = false,
  isLast = false,
  onMore,
}: {
  stock?: string;
  page?: number;
  compact?: boolean;
  isLast?: boolean;
  onMore?: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["news", stock ?? "all", page],
    queryFn: () =>
      getJson<NewsPageDto>(
        `/api/news?page=${page}${stock ? `&stock=${stock}` : ""}`
      ),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const items = compact ? data?.items.slice(0, 5) : data?.items;

  if (!items || items.length === 0) {
    // 빈 안내는 첫 페이지에서만 — 추가 페이지가 비었을 땐 아무것도 그리지 않는다
    if (page === 1) {
      return (
        <p className="py-8 text-center text-sm text-muted-foreground">
          아직 소식이 없습니다
        </p>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-col divide-y divide-border/60">
      {items.map((n) => (
        <article key={n.id} className="py-3">
          <div className="flex items-center gap-2">
            <Badge className={cn("px-1.5 text-[11px]", GRADE_META[n.grade].className)}>
              {GRADE_META[n.grade].label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatDate(n.date)}
              {!stock && n.stockName ? ` · ${n.stockName}` : ""}
            </span>
          </div>
          <h3 className="mt-1.5 font-medium leading-snug">{n.title}</h3>
          {!compact && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{n.body}</p>
          )}
        </article>
      ))}
      {/* 다음 페이지가 있을 때만 마지막 블록에 더 보기 노출 */}
      {!compact && isLast && data?.hasMore && onMore && (
        <Button variant="ghost" className="my-2" onClick={onMore}>
          더 보기
        </Button>
      )}
    </div>
  );
}

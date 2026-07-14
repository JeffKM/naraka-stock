"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { NewsList } from "@/components/news/NewsList";
import { useQuotes } from "@/hooks/useQuotes";
import { cn } from "@/lib/utils";

// 뉴스 피드 (T-503): 등급 배지 + 종목 필터
export default function NewsPage() {
  const { data } = useQuotes();
  const [filter, setFilter] = useState<string | null>(null);
  const [pages, setPages] = useState(1);

  function selectFilter(code: string | null) {
    setFilter(code);
    setPages(1);
  }

  return (
    <div className="flex flex-col">
      {/* 피드 헤더 — 상단 고정 (SNS 타임라인 감성) */}
      <div className="sticky top-14 z-20 -mx-4 border-b border-border bg-background/80 px-4 pb-2 pt-1 backdrop-blur">
        <h1 className="py-2 text-xl font-bold">소식통</h1>

        {/* 종목 필터 — 27종을 한 줄 가로 스크롤로 (여러 줄 wrap 방지) */}
        <div className="-mx-4 px-4">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <FilterChip active={filter === null} onClick={() => selectFilter(null)}>
              전체
            </FilterChip>
            {data?.quotes.map((q) => (
              <FilterChip
                key={q.code}
                active={filter === q.code}
                onClick={() => selectFilter(q.code)}
              >
                {q.name}
              </FilterChip>
            ))}
          </div>
        </div>
      </div>

      {/* 피드 — 인스타식 개별 카드(각 뉴스가 분리, bg-card라 배경 그리드 안 비침) */}
      <div className="mt-4 flex flex-col gap-3">
        {Array.from({ length: pages }, (_, i) => (
          <NewsList
            key={i}
            stock={filter ?? undefined}
            page={i + 1}
            isLast={i + 1 === pages}
            onMore={() => setPages((p) => p + 1)}
          />
        ))}
      </div>

      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        정식 뉴스도 가끔 틀리고, 찌라시는 절반만 믿으세요
      </p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Badge
      onClick={onClick}
      className={cn(
        "shrink-0 cursor-pointer select-none whitespace-nowrap px-2.5 py-1",
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Badge>
  );
}

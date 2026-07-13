"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">뉴스</h1>

      <div className="flex flex-wrap gap-1.5">
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

      <Card>
        <CardContent className="py-1">
          {Array.from({ length: pages }, (_, i) => (
            <NewsList
              key={i}
              stock={filter ?? undefined}
              page={i + 1}
              isLast={i + 1 === pages}
              onMore={() => setPages((p) => p + 1)}
            />
          ))}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
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
        "cursor-pointer select-none px-2.5 py-1",
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Badge>
  );
}

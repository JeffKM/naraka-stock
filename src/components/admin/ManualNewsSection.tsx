"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteJson, getJson, postJson } from "@/lib/api/client";
import { useQuotes } from "@/hooks/useQuotes";

interface ManualNewsItem {
  id: number;
  date: string;
  stockCode: string | null;
  stockName: string | null;
  source: string | null;
  title: string;
  publishedAt: string;
}

// 수동 뉴스는 항상 찌라시(rumor)로 발행한다. 등급 선택 없이 출처(기자·매체명)만 입력.
export function ManualNewsSection() {
  const queryClient = useQueryClient();
  const { data: quotes } = useQuotes();
  const [stock, setStock] = useState<string>("");
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const { data } = useQuery({
    queryKey: ["admin-manual-news"],
    queryFn: () => getJson<{ items: ManualNewsItem[] }>("/api/admin/news"),
  });

  async function publish() {
    try {
      await postJson("/api/admin/news", {
        stockCode: stock || null,
        source: source.trim(),
        title,
        body,
      });
      toast.success("찌라시 발행 완료");
      setTitle("");
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["admin-manual-news"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "발행 실패");
    }
  }

  async function remove(id: number) {
    try {
      await deleteJson(`/api/admin/news?id=${id}`);
      toast.success("찌라시 삭제 완료");
      queryClient.invalidateQueries({ queryKey: ["admin-manual-news"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제 실패");
    }
  }

  const items = data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">찌라시 발행</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-2">
          <select
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            className="rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">시장 전체</option>
            {quotes?.quotes.map((q) => (
              <option key={q.code} value={q.code}>
                {q.name}
              </option>
            ))}
          </select>
          <Input
            placeholder="출처 (예: 옥자, 나라카 숲)"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="flex-1"
          />
        </div>
        <Input placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          placeholder="본문"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="h-20 w-full rounded-lg border bg-background p-2 text-sm"
        />
        <Button
          onClick={publish}
          disabled={!source.trim() || !title.trim() || !body.trim()}
        >
          발행
        </Button>

        {/* 발행한 찌라시 목록 — 삭제 관리 */}
        {items.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-t pt-2">
            <p className="text-xs text-muted-foreground">발행한 찌라시</p>
            {items.map((n) => (
              <div
                key={n.id}
                className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-1.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{n.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {n.date.slice(5)} · {n.source ?? "익명"}
                    {n.stockName ? ` · ${n.stockName}` : " · 시장 전체"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(n.id)}
                  aria-label="삭제"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

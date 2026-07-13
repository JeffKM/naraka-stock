"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api/client";
import { useQuotes } from "@/hooks/useQuotes";

export function ManualNewsSection() {
  const { data: quotes } = useQuotes();
  const [stock, setStock] = useState<string>("");
  const [grade, setGrade] = useState<"news" | "rumor" | "disclosure">("news");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  async function publish() {
    try {
      await postJson("/api/admin/news", {
        stockCode: stock || null,
        grade,
        title,
        body,
      });
      toast.success("뉴스 발행 완료");
      setTitle("");
      setBody("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "발행 실패");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">수동 뉴스 발행</CardTitle>
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
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value as typeof grade)}
            className="rounded-lg border bg-background px-2 text-sm"
          >
            <option value="news">📢 뉴스</option>
            <option value="rumor">💬 찌라시</option>
            <option value="disclosure">📰 공시</option>
          </select>
        </div>
        <Input placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          placeholder="본문"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="h-20 w-full rounded-lg border bg-background p-2 text-sm"
        />
        <Button onClick={publish} disabled={!title.trim() || !body.trim()}>
          발행
        </Button>
      </CardContent>
    </Card>
  );
}

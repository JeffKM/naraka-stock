"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson, postJson } from "@/lib/api/client";

interface StockComment {
  id: number;
  nickname: string;
  content: string;
  createdAt: string;
  mine: boolean;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  });
}

// 종목 토론방 (토스 벤치마킹): 주가 보면서 밈·찌라시 나누는 실시간 댓글창.
// 10초 폴링으로 다른 손님 댓글이 흘러들어온다.
export function StockComments({ stockCode }: { stockCode: string }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data } = useQuery({
    queryKey: ["comments", stockCode],
    queryFn: () =>
      getJson<{ comments: StockComment[] }>(`/api/stocks/${stockCode}/comments`),
    refetchInterval: 10_000,
  });

  async function submit() {
    const trimmed = content.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await postJson(`/api/stocks/${stockCode}/comments`, { content: trimmed });
      setContent("");
      queryClient.invalidateQueries({ queryKey: ["comments", stockCode] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "댓글 작성에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: number) {
    try {
      const res = await fetch(`/api/stocks/${stockCode}/comments?id=${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      queryClient.invalidateQueries({ queryKey: ["comments", stockCode] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제에 실패했습니다.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          토론방{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {data ? `${data.comments.length}개` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            placeholder="한마디 남기기 (200자)"
            value={content}
            maxLength={200}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()}
          />
          <Button onClick={submit} disabled={submitting || !content.trim()}>
            등록
          </Button>
        </div>

        <div className="flex flex-col divide-y divide-border/60">
          {data?.comments.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              아직 댓글이 없습니다. 첫 밈을 남겨보세요!
            </p>
          )}
          {data?.comments.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.nickname}</span>{" "}
                  · {relativeTime(c.createdAt)}
                </p>
                <p className="mt-0.5 break-words text-sm">{c.content}</p>
              </div>
              {c.mine && (
                <button
                  onClick={() => remove(c.id)}
                  aria-label="내 댓글 삭제"
                  className="mt-1 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

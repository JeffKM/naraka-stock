"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getJson, postJson } from "@/lib/api/client";
import type { SupportCategory, SupportPost } from "@/types/domain";

const CATEGORIES: Array<{ value: SupportCategory; label: string }> = [
  { value: "bug", label: "🐛 버그 신고" },
  { value: "inquiry", label: "❓ 문의" },
  { value: "suggestion", label: "💡 건의" },
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 고객센터 (버그·문의 접수): 글을 남기면 운영자가 확인 후 답변을 달아준다
export default function SupportPage() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<SupportCategory>("inquiry");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["support"],
    queryFn: () => getJson<{ posts: SupportPost[] }>("/api/support"),
  });

  async function submit() {
    if (content.trim().length < 2 || submitting) return;
    setSubmitting(true);
    try {
      await postJson("/api/support", { category, content: content.trim() });
      toast.success("접수 완료! 확인하는 대로 답변을 남겨드릴게요 👹");
      setContent("");
      queryClient.invalidateQueries({ queryKey: ["support"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "접수에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">고객센터</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">문의 남기기</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            버그나 궁금한 점을 남겨주세요. 운영자가 확인하고 답변을 달아드립니다.
          </p>
          <div className="flex gap-1">
            {CATEGORIES.map((c) => (
              <Button
                key={c.value}
                size="sm"
                variant={category === c.value ? "default" : "outline"}
                onClick={() => setCategory(c.value)}
              >
                {c.label}
              </Button>
            ))}
          </div>
          <textarea
            placeholder="내용을 적어주세요 (최대 1,000자)"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={1000}
            className="h-28 w-full rounded-lg border bg-background p-2 text-sm"
          />
          <Button onClick={submit} disabled={submitting || content.trim().length < 2}>
            {submitting ? "접수 중..." : "접수하기"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">내 문의 내역</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border/60">
          {isLoading && <Skeleton className="h-16 w-full" />}
          {data?.posts.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              아직 남긴 문의가 없습니다
            </p>
          )}
          {data?.posts.map((post) => (
            <div key={post.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{CATEGORY_LABEL[post.category]}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {formatTime(post.createdAt)}
                  {post.status === "done" ? (
                    <Badge className="px-1.5 text-[11px]">처리완료</Badge>
                  ) : (
                    <Badge variant="secondary" className="px-1.5 text-[11px]">
                      접수됨
                    </Badge>
                  )}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{post.content}</p>
              {post.reply && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                  <p className="mb-1 text-xs font-medium text-primary">👹 나라카 답변</p>
                  <p className="whitespace-pre-wrap text-sm">{post.reply}</p>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

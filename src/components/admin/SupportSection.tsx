"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getJson } from "@/lib/api/client";
import type { AdminSupportPost } from "@/types/domain";

const SUPPORT_CATEGORY_LABEL: Record<string, string> = {
  bug: "버그",
  inquiry: "문의",
  suggestion: "건의",
};

// 문의 관리: 미처리 문의 확인 → 답변 저장/완료 처리
export function SupportSection() {
  const [showDone, setShowDone] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin-support", showDone],
    queryFn: () =>
      getJson<{ posts: AdminSupportPost[] }>(
        `/api/admin/support${showDone ? "" : "?status=pending"}`
      ),
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>문의 관리</span>
          <Button size="sm" variant="outline" onClick={() => setShowDone(!showDone)}>
            {showDone ? "미처리만 보기" : "전체 보기"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border/60">
        {data?.posts.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {showDone ? "문의가 없습니다" : "미처리 문의가 없습니다"}
          </p>
        )}
        {data?.posts.map((post) => (
          <SupportPostItem key={post.id} post={post} />
        ))}
      </CardContent>
    </Card>
  );
}

function SupportPostItem({ post }: { post: AdminSupportPost }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState(post.reply ?? "");
  const [busy, setBusy] = useState(false);

  async function update(
    body: { reply?: string; status?: "open" | "reviewing" | "done" },
    message: string
  ) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/support", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, ...body }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success(message);
      queryClient.invalidateQueries({ queryKey: ["admin-support"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  const time = new Date(post.createdAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {SUPPORT_CATEGORY_LABEL[post.category]}{" "}
          <span className="text-muted-foreground">· {post.nickname}</span>
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {time}
          {post.status === "done" ? (
            <Badge variant="secondary" className="px-1.5 text-[11px]">
              답변완료
            </Badge>
          ) : post.status === "reviewing" ? (
            <Badge variant="outline" className="px-1.5 text-[11px] text-primary">
              검토중
            </Badge>
          ) : (
            <Badge variant="outline" className="px-1.5 text-[11px]">
              접수완료
            </Badge>
          )}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{post.content}</p>
      <textarea
        placeholder="답변 (유저 화면에 표시됩니다)"
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        maxLength={1000}
        className="h-16 w-full rounded-lg border bg-background p-2 text-sm"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || !reply.trim()}
          onClick={() => update({ reply: reply.trim(), status: "done" }, "답변 저장 + 완료 처리")}
        >
          답변하고 완료
        </Button>
        {post.status === "open" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => update({ status: "reviewing" }, "검토중으로 표시")}
          >
            검토중으로
          </Button>
        )}
        {post.status !== "done" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => update({ status: "done" }, "완료 처리")}
          >
            답변 없이 완료
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => update({ status: "open" }, "접수완료로 되돌림")}
          >
            접수 상태로
          </Button>
        )}
      </div>
    </div>
  );
}

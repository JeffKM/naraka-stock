"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Pencil, ThumbsUp, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson, patchJson, postJson } from "@/lib/api/client";

interface StockComment {
  id: number;
  nickname: string;
  content: string;
  createdAt: string;
  mine: boolean;
  likeCount: number;
  likedByMe: boolean;
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ["comments", stockCode],
    queryFn: () =>
      getJson<{ comments: StockComment[]; viewerIsAdmin: boolean }>(
        `/api/stocks/${stockCode}/comments`
      ),
    refetchInterval: 10_000,
  });

  const isAdmin = data?.viewerIsAdmin ?? false;

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

  function startEdit(c: StockComment) {
    setEditingId(c.id);
    setEditContent(c.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent("");
  }

  async function saveEdit(id: number) {
    const trimmed = editContent.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await patchJson(`/api/stocks/${stockCode}/comments`, { id, content: trimmed });
      cancelEdit();
      queryClient.invalidateQueries({ queryKey: ["comments", stockCode] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "수정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: StockComment) {
    const message = c.mine
      ? "이 댓글을 삭제할까요?"
      : `'${c.nickname}'님의 댓글을 삭제할까요? (관리자 권한)`;
    if (!window.confirm(message)) return;
    const id = c.id;
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

  async function toggleLike(c: StockComment) {
    try {
      await postJson<{ liked: boolean; likeCount: number }>(
        `/api/comments/${c.id}/like`
      );
      queryClient.invalidateQueries({ queryKey: ["comments", stockCode] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "반응에 실패했습니다.");
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
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.nickname}</span>{" "}
                  · {relativeTime(c.createdAt)}
                </p>
                {editingId === c.id ? (
                  <div className="mt-1 flex gap-2">
                    <Input
                      value={editContent}
                      maxLength={200}
                      autoFocus
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) saveEdit(c.id);
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                  </div>
                ) : (
                  <>
                    <p className="mt-0.5 break-words text-sm">{c.content}</p>
                    <button
                      onClick={() => toggleLike(c)}
                      aria-label={c.likedByMe ? "엄지업 취소" : "엄지업"}
                      className={`mt-1 inline-flex items-center gap-1 text-xs transition-colors ${
                        c.likedByMe
                          ? "text-primary-accent"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <ThumbsUp
                        className={`size-3.5 ${c.likedByMe ? "fill-current" : ""}`}
                      />
                      {c.likeCount > 0 && <span>{c.likeCount}</span>}
                    </button>
                  </>
                )}
              </div>
              {(c.mine || isAdmin) &&
                (editingId === c.id ? (
                  <div className="mt-1 flex shrink-0 gap-1.5">
                    <button
                      onClick={() => saveEdit(c.id)}
                      disabled={saving || !editContent.trim()}
                      aria-label="댓글 수정 저장"
                      className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                    >
                      <Check className="size-3.5" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      aria-label="수정 취소"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 flex shrink-0 gap-1.5">
                    {/* 수정은 본인 댓글만, 삭제는 본인 또는 어드민 */}
                    {c.mine && (
                      <button
                        onClick={() => startEdit(c)}
                        aria-label="내 댓글 수정"
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => remove(c)}
                      aria-label={c.mine ? "내 댓글 삭제" : "댓글 삭제 (관리자)"}
                      className={`text-muted-foreground transition-colors ${
                        c.mine ? "hover:text-foreground" : "hover:text-destructive"
                      }`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

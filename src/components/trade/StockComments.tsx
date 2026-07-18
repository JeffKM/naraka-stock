"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, MessageCircle, Pencil, ThumbsUp, X } from "lucide-react";
import { toast } from "sonner";
import { BadgeChip } from "@/components/badges/BadgeChip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson, patchJson, postJson } from "@/lib/api/client";
import { EmptyState } from "@/components/mascot/EmptyState";
import { StickerPicker } from "@/components/trade/StickerPicker";
import { useStickers, type CatalogSticker } from "@/hooks/useStickers";
import { cn } from "@/lib/utils";
import type { WeeklyBadge } from "@/types/domain";

interface StockComment {
  id: number;
  nickname: string;
  content: string | null;
  createdAt: string;
  mine: boolean;
  likeCount: number;
  likedByMe: boolean;
  representativeBadge: WeeklyBadge | null;
  stickerId: string | null;
  deleted: boolean;
  replies?: StockComment[];
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
// 10초 폴링으로 다른 손님 댓글이 흘러들어온다. 최상위 댓글 + 2단계 평톤 답글.
export function StockComments({ stockCode }: { stockCode: string }) {
  const queryClient = useQueryClient();
  const { byId } = useStickers();
  const [content, setContent] = useState("");
  const [sticker, setSticker] = useState<CatalogSticker | null>(null);
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

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["comments", stockCode] });
  }

  async function submitTop() {
    const trimmed = content.trim();
    if ((!trimmed && !sticker) || submitting) return;
    setSubmitting(true);
    try {
      await postJson(`/api/stocks/${stockCode}/comments`, {
        content: trimmed || undefined,
        stickerId: sticker?.id,
      });
      setContent("");
      setSticker(null);
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "댓글 작성에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(c: StockComment) {
    setEditingId(c.id);
    setEditContent(c.content ?? "");
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
      invalidate();
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
    try {
      const res = await fetch(`/api/stocks/${stockCode}/comments?id=${c.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제에 실패했습니다.");
    }
  }

  async function toggleLike(c: StockComment) {
    try {
      await postJson(`/api/comments/${c.id}/like`);
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "반응에 실패했습니다.");
    }
  }

  // 전체 댓글 수(묘비 제외, 부모+답글)
  const total = (data?.comments ?? []).reduce(
    (sum, c) => sum + (c.deleted ? 0 : 1) + (c.replies?.filter((r) => !r.deleted).length ?? 0),
    0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          토론방{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {data ? `${total}개` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CommentComposer
          content={content}
          setContent={setContent}
          sticker={sticker}
          setSticker={setSticker}
          submitting={submitting}
          onSubmit={submitTop}
        />

        <div className="flex flex-col divide-y divide-border/60">
          {data?.comments.length === 0 && (
            <EmptyState
              className="py-6"
              title="아직 댓글이 없어요."
              description="첫 밈을 남겨보세요."
            />
          )}
          {data?.comments.map((c) => (
            <div key={c.id} className="py-2.5">
              <CommentRow
                comment={c}
                stockCode={stockCode}
                byId={byId}
                isAdmin={isAdmin}
                editingId={editingId}
                editContent={editContent}
                saving={saving}
                onStartEdit={startEdit}
                onCancelEdit={cancelEdit}
                onSaveEdit={saveEdit}
                onEditContentChange={setEditContent}
                onRemove={remove}
                onToggleLike={toggleLike}
                onReplied={invalidate}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// 상단 작성창(최상위 댓글 전용) — 스티커 피커 포함
function CommentComposer({
  content,
  setContent,
  sticker,
  setSticker,
  submitting,
  onSubmit,
}: {
  content: string;
  setContent: (v: string) => void;
  sticker: CatalogSticker | null;
  setSticker: (v: CatalogSticker | null) => void;
  submitting: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {sticker && (
        <div className="flex items-center gap-2 rounded-md border border-border/60 p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sticker.imageUrl} alt={sticker.label} className="size-12 object-contain" />
          <span className="text-xs text-muted-foreground">{sticker.label}</span>
          <button
            type="button"
            onClick={() => setSticker(null)}
            aria-label="스티커 제거"
            className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <StickerPicker onSelect={setSticker} />
        <Input
          placeholder="한마디 남기기 (200자)"
          value={content}
          maxLength={200}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && onSubmit()}
        />
        <Button onClick={onSubmit} disabled={submitting || (!content.trim() && !sticker)}>
          등록
        </Button>
      </div>
    </div>
  );
}

// 최상위 댓글 한 건 + 답글 스레드 토글/입력
function CommentRow({
  comment: c,
  stockCode,
  byId,
  isAdmin,
  editingId,
  editContent,
  saving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditContentChange,
  onRemove,
  onToggleLike,
  onReplied,
}: {
  comment: StockComment;
  stockCode: string;
  byId: Map<string, CatalogSticker>;
  isAdmin: boolean;
  editingId: number | null;
  editContent: string;
  saving: boolean;
  onStartEdit: (c: StockComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onEditContentChange: (v: string) => void;
  onRemove: (c: StockComment) => void;
  onToggleLike: (c: StockComment) => void;
  onReplied: () => void;
}) {
  const [showReplies, setShowReplies] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const replies = c.replies ?? [];

  // 묘비: 작성자·액션 없이 안내문만, 답글은 유지
  if (c.deleted) {
    return (
      <>
        <p className="text-xs italic text-muted-foreground">삭제된 댓글입니다.</p>
        <ReplyThread
          replies={replies}
          showReplies={showReplies}
          setShowReplies={setShowReplies}
          replyOpen={replyOpen}
          setReplyOpen={setReplyOpen}
          parentDeleted
          stockCode={stockCode}
          byId={byId}
          isAdmin={isAdmin}
          editingId={editingId}
          editContent={editContent}
          saving={saving}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
          onEditContentChange={onEditContentChange}
          onRemove={onRemove}
          onToggleLike={onToggleLike}
          onReplied={onReplied}
          parentId={c.id}
          parentNickname={c.nickname}
        />
      </>
    );
  }

  return (
    <>
      <CommentBody
        c={c}
        byId={byId}
        isAdmin={isAdmin}
        editingId={editingId}
        editContent={editContent}
        saving={saving}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onEditContentChange={onEditContentChange}
        onRemove={onRemove}
        onToggleLike={onToggleLike}
        onReply={() => {
          setShowReplies(true);
          setReplyOpen((v) => !v);
        }}
      />
      <ReplyThread
        replies={replies}
        showReplies={showReplies}
        setShowReplies={setShowReplies}
        replyOpen={replyOpen}
        setReplyOpen={setReplyOpen}
        stockCode={stockCode}
        byId={byId}
        isAdmin={isAdmin}
        editingId={editingId}
        editContent={editContent}
        saving={saving}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onEditContentChange={onEditContentChange}
        onRemove={onRemove}
        onToggleLike={onToggleLike}
        onReplied={onReplied}
        parentId={c.id}
        parentNickname={c.nickname}
      />
    </>
  );
}

// 댓글/답글 본문 공용 (묘비 아닌 행). onReply가 있으면 "답글" 버튼 노출(최상위만).
function CommentBody({
  c,
  byId,
  isAdmin,
  editingId,
  editContent,
  saving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditContentChange,
  onRemove,
  onToggleLike,
  onReply,
}: {
  c: StockComment;
  byId: Map<string, CatalogSticker>;
  isAdmin: boolean;
  editingId: number | null;
  editContent: string;
  saving: boolean;
  onStartEdit: (c: StockComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onEditContentChange: (v: string) => void;
  onRemove: (c: StockComment) => void;
  onToggleLike: (c: StockComment) => void;
  onReply?: () => void;
}) {
  const sticker = c.stickerId ? byId.get(c.stickerId) : undefined;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{c.nickname}</span>{" "}
          {c.representativeBadge && <BadgeChip badge={c.representativeBadge} />}{" "}
          · {relativeTime(c.createdAt)}
        </p>
        {editingId === c.id ? (
          <div className="mt-1 flex gap-2">
            <Input
              value={editContent}
              maxLength={200}
              autoFocus
              onChange={(e) => onEditContentChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) onSaveEdit(c.id);
                if (e.key === "Escape") onCancelEdit();
              }}
            />
          </div>
        ) : (
          <>
            {c.content && <p className="mt-0.5 break-words text-sm">{c.content}</p>}
            {sticker && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sticker.imageUrl} alt={sticker.label} className="mt-1 size-24 object-contain" />
            )}
            <div className="mt-1 flex items-center gap-3">
              <button
                onClick={() => onToggleLike(c)}
                aria-label={c.likedByMe ? "엄지업 취소" : "엄지업"}
                className={cn(
                  "inline-flex items-center gap-1 text-xs transition-colors",
                  c.likedByMe
                    ? "text-primary-accent"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ThumbsUp className={cn("size-3.5", c.likedByMe && "fill-current")} />
                {c.likeCount > 0 && <span>{c.likeCount}</span>}
              </button>
              {onReply && (
                <button
                  onClick={onReply}
                  aria-label="답글 달기"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <MessageCircle className="size-3.5" />
                  답글
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {(c.mine || isAdmin) &&
        (editingId === c.id ? (
          <div className="mt-1 flex shrink-0 gap-1.5">
            <button
              onClick={() => onSaveEdit(c.id)}
              disabled={saving || !editContent.trim()}
              aria-label="댓글 수정 저장"
              className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Check className="size-3.5" />
            </button>
            <button
              onClick={onCancelEdit}
              aria-label="수정 취소"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="mt-1 flex shrink-0 gap-1.5">
            {c.mine && !!c.content && (
              <button
                onClick={() => onStartEdit(c)}
                aria-label="내 댓글 수정"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
            <button
              onClick={() => onRemove(c)}
              aria-label={c.mine ? "내 댓글 삭제" : "댓글 삭제 (관리자)"}
              className={cn(
                "text-muted-foreground transition-colors",
                c.mine ? "hover:text-foreground" : "hover:text-destructive"
              )}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
    </div>
  );
}

// 답글 스레드: "답글 N개 보기" 토글 + 답글 목록 + 답글 입력창
function ReplyThread({
  replies,
  showReplies,
  setShowReplies,
  replyOpen,
  setReplyOpen,
  parentDeleted = false,
  stockCode,
  byId,
  isAdmin,
  editingId,
  editContent,
  saving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditContentChange,
  onRemove,
  onToggleLike,
  onReplied,
  parentId,
  parentNickname,
}: {
  replies: StockComment[];
  showReplies: boolean;
  setShowReplies: (v: boolean) => void;
  replyOpen: boolean;
  setReplyOpen: (v: boolean) => void;
  parentDeleted?: boolean;
  stockCode: string;
  byId: Map<string, CatalogSticker>;
  isAdmin: boolean;
  editingId: number | null;
  editContent: string;
  saving: boolean;
  onStartEdit: (c: StockComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onEditContentChange: (v: string) => void;
  onRemove: (c: StockComment) => void;
  onToggleLike: (c: StockComment) => void;
  onReplied: () => void;
  parentId: number;
  parentNickname: string;
}) {
  const hasReplies = replies.length > 0;
  return (
    <div className="mt-1 pl-4">
      {hasReplies && (
        <button
          onClick={() => setShowReplies(!showReplies)}
          className="text-xs font-medium text-primary-accent hover:underline"
        >
          {showReplies ? "답글 숨기기" : `답글 ${replies.length}개 보기`}
        </button>
      )}
      {showReplies && (
        <div className="mt-1 flex flex-col gap-2 border-l border-border/60 pl-3">
          {replies.map((r) =>
            r.deleted ? (
              <p key={r.id} className="text-xs italic text-muted-foreground">
                삭제된 댓글입니다.
              </p>
            ) : (
              <CommentBody
                key={r.id}
                c={r}
                byId={byId}
                isAdmin={isAdmin}
                editingId={editingId}
                editContent={editContent}
                saving={saving}
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                onSaveEdit={onSaveEdit}
                onEditContentChange={onEditContentChange}
                onRemove={onRemove}
                onToggleLike={onToggleLike}
              />
            )
          )}
        </div>
      )}
      {replyOpen && !parentDeleted && (
        <ReplyComposer
          stockCode={stockCode}
          parentId={parentId}
          parentNickname={parentNickname}
          onDone={() => {
            setReplyOpen(false);
            setShowReplies(true);
            onReplied();
          }}
        />
      )}
    </div>
  );
}

// 답글 입력창: @부모작성자 프리필. 텍스트 전용(스티커는 최상위만).
function ReplyComposer({
  stockCode,
  parentId,
  parentNickname,
  onDone,
}: {
  stockCode: string;
  parentId: number;
  parentNickname: string;
  onDone: () => void;
}) {
  const [value, setValue] = useState(`@${parentNickname} `);
  const [busy, setBusy] = useState(false);

  async function send() {
    const trimmed = value.trim();
    const mentionOnly = `@${parentNickname}`;
    // 프리필(@닉네임)만 있고 실제 내용이 없으면 등록하지 않는다
    if (!trimmed || trimmed === mentionOnly || busy) return;
    setBusy(true);
    try {
      await postJson(`/api/stocks/${stockCode}/comments`, {
        content: trimmed,
        parentId,
      });
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "답글 작성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex gap-2">
      <Input
        placeholder="답글 남기기 (200자)"
        value={value}
        maxLength={200}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send()}
      />
      <Button
        size="sm"
        onClick={send}
        disabled={busy || !value.trim() || value.trim() === `@${parentNickname}`}
      >
        답글
      </Button>
    </div>
  );
}

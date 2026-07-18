"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { BadgeChip } from "@/components/badges/BadgeChip";
import { Badge } from "@/components/ui/badge";
import { getJson, postJson } from "@/lib/api/client";
import type { WeeklyBadge } from "@/types/domain";

interface DiscussionComment {
  id: number;
  nickname: string;
  content: string;
  createdAt: string;
  mine: boolean;
  likeCount: number;
  likedByMe: boolean;
  stockCode: string;
  stockName: string;
  representativeBadge: WeeklyBadge | null;
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

// 토론 세그먼트: 전 종목 댓글을 시간순으로 모아 보는 읽기 전용 뷰.
// 작성은 각 종목 상세에서만 — 여기선 읽기 + 엄지업만 가능하다.
export function DiscussionList() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["discussion", 1],
    queryFn: () =>
      getJson<{ comments: DiscussionComment[]; viewerIsAdmin: boolean }>(
        "/api/comments?page=1"
      ),
    refetchInterval: 15_000,
  });

  async function toggleLike(c: DiscussionComment) {
    try {
      await postJson(`/api/comments/${c.id}/like`);
      queryClient.invalidateQueries({ queryKey: ["discussion", 1] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "반응에 실패했습니다.");
    }
  }

  if (data && data.comments.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        아직 올라온 토론이 없습니다
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {data?.comments.map((c) => (
        <article
          key={c.id}
          className="rounded-xl border border-foreground/[0.14] bg-card px-4 py-3 shadow-sm"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{c.nickname}</span>
            {c.representativeBadge && <BadgeChip badge={c.representativeBadge} />}
            <span>·</span>
            <span>{relativeTime(c.createdAt)}</span>
            <Link href={`/stocks/${c.stockCode}`} className="ml-auto">
              <Badge className="cursor-pointer bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground">
                {c.stockName}
              </Badge>
            </Link>
          </div>
          <p className="mt-1 break-words text-sm">{c.content}</p>
          <button
            onClick={() => toggleLike(c)}
            aria-label={c.likedByMe ? "엄지업 취소" : "엄지업"}
            className={`mt-1.5 inline-flex items-center gap-1 text-xs transition-colors ${
              c.likedByMe
                ? "text-primary-accent"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ThumbsUp className={`size-3.5 ${c.likedByMe ? "fill-current" : ""}`} />
            {c.likeCount > 0 && <span>{c.likeCount}</span>}
          </button>
        </article>
      ))}
    </div>
  );
}

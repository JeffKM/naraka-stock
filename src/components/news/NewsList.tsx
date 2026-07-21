"use client";

import Image from "next/image";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getJson, postJson } from "@/lib/api/client";
import { outletForNewsId } from "@/lib/news/outlets";
import { cn } from "@/lib/utils";
import type { NewsGrade, NewsItem } from "@/types/domain";

type NewsReactionKind = "up" | "down";

interface NewsFeedItem extends NewsItem {
  upCount: number;
  downCount: number;
  myReaction: NewsReactionKind | null;
}

export interface NewsPageDto {
  items: NewsFeedItem[];
  page: number;
  hasMore: boolean;
}

// 뉴스 3등급 → SNS 계정 3종 (공식 인증 / 언론사 / 익명 찌라시)
interface GradeMeta {
  verified: boolean;
  avatarClass: string;
  checkClass: string;
  label?: string; // 미인증 등급 경고 칩 문구 (없으면 미표시)
}

const GRADE_META: Record<NewsGrade, GradeMeta> = {
  disclosure: {
    verified: true,
    avatarClass: "bg-secondary text-secondary-foreground",
    checkClass: "text-secondary-foreground",
  },
  news: {
    verified: true,
    avatarClass: "bg-primary text-primary-foreground",
    checkClass: "text-primary-accent",
  },
  rumor: {
    verified: false,
    avatarClass: "border border-border bg-muted text-muted-foreground",
    checkClass: "",
    label: "미확인",
  },
};

// 발행 시각(publishedAt, UTC ISO)을 KST "M/D HH:MM"으로. 뉴스 등급마다 노출 시각이
// 달라(공시=폐장/정식=장 후반/찌라시=장중) 분 단위로 "언제 터진 소식인지"를 드러낸다.
// 브라우저 타임존과 무관하게 항상 KST로 고정(이벤트가 KST 기준).
function formatPublishedAt(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

// 게시물 작성자 정보 — 등급 + 종목으로 결정.
// outletSlug가 있으면 정식 뉴스 매체 페이지로 이동 가능한 계정이다.
function authorOf(n: NewsItem): {
  name: string;
  handle: string;
  avatar: string;
  logo?: string;
  outletSlug?: string;
} {
  // 공시: 해당 종목의 공식 계정 (시장 전체 공지는 거래소 계정)
  if (n.grade === "disclosure") {
    if (n.stockName) {
      return {
        name: n.stockName,
        handle: `@${(n.stockCode ?? "naraka").toLowerCase()}`,
        avatar: n.stockName.slice(0, 2),
      };
    }
    return { name: "나라카 거래소", handle: "@naraka_exchange", avatar: "거래" };
  }
  // 정식 뉴스: 매체 풀에서 id 기반 고정 배정
  if (n.grade === "news") {
    const outlet = outletForNewsId(n.id);
    return {
      name: outlet.name,
      handle: outlet.handle,
      avatar: outlet.avatar,
      logo: outlet.logo,
      outletSlug: outlet.slug,
    };
  }
  // 찌라시: 출처(기자·매체명)가 지정돼 있으면 그 이름으로, 없으면 익명 제보 계정
  if (n.source) {
    return {
      name: n.source,
      handle: `@${n.source.replace(/\s+/g, "")}`,
      avatar: n.source.slice(0, 2),
    };
  }
  return { name: "나라카 찌라시", handle: "@naraka_whisper", avatar: "찌" };
}

// 뉴스 피드 (T-503/504 공용) — stock 지정 시 해당 종목만
// isLast + onMore: 페이지 누적 방식에서 마지막 블록이 "더 보기" 버튼을 담당
export function NewsList({
  stock,
  outlet,
  page = 1,
  compact = false,
  isLast = false,
  onMore,
}: {
  stock?: string;
  outlet?: string; // 정식 뉴스 매체 slug — 해당 매체 뉴스만
  page?: number;
  compact?: boolean;
  isLast?: boolean;
  onMore?: () => void;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["news", stock ?? "all", outlet ?? "all", page],
    queryFn: () =>
      getJson<NewsPageDto>(
        `/api/news?page=${page}${stock ? `&stock=${stock}` : ""}${
          outlet ? `&outlet=${outlet}` : ""
        }`
      ),
    staleTime: 60_000,
  });

  // 엄지업/다운 토글 — 같은 방향 재클릭 시 취소, 반대 방향 클릭 시 전환
  async function react(n: NewsFeedItem, kind: NewsReactionKind) {
    try {
      await postJson(`/api/news/${n.id}/reaction`, { kind });
      queryClient.invalidateQueries({ queryKey: ["news"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "반응에 실패했습니다.");
    }
  }

  // compact(카드 내부)는 얇은 구분선, 전체 피드는 카드 사이 간격
  const containerClass = compact
    ? "flex flex-col divide-y divide-border/60"
    : "flex flex-col gap-3";

  if (isLoading) {
    return (
      <div className={containerClass}>
        <PostSkeleton compact={compact} />
        <PostSkeleton compact={compact} />
      </div>
    );
  }

  const items = compact ? data?.items.slice(0, 5) : data?.items;

  if (!items || items.length === 0) {
    // 빈 안내는 첫 페이지에서만 — 추가 페이지가 비었을 땐 아무것도 그리지 않는다
    if (page === 1) {
      return (
        <p className="py-10 text-center text-sm text-muted-foreground">
          아직 올라온 소식이 없습니다
        </p>
      );
    }
    return null;
  }

  return (
    <div className={containerClass}>
      {items.map((n) => {
        const meta = GRADE_META[n.grade];
        const author = authorOf(n);
        // 공시 = 종목 공식 계정 (작성자 이름이 곧 종목명)
        const stockAccount =
          n.grade === "disclosure" && !!n.stockCode && !!n.stockName;
        return (
          <article
            key={n.id}
            className={cn(
              "flex gap-3",
              // compact: 카드 없이 행 + 좌우 패딩 0 (상위 카드가 이미 패딩)
              // 전체 피드: 게시물마다 개별 카드 (인스타식 분리)
              compact
                ? "py-3.5"
                : "rounded-xl border border-foreground/[0.14] bg-card px-4 py-3.5 shadow-sm transition-colors hover:border-foreground/25 hover:bg-muted/20"
            )}
          >
            {/* 아바타 — 정식 뉴스는 매체 로고, 그 외(공시·찌라시)는 텍스트 배지 */}
            {author.logo ? (
              <div className="flex size-10 shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                <Image
                  src={author.logo}
                  alt={author.name}
                  width={40}
                  height={40}
                  className="size-8 object-contain"
                />
              </div>
            ) : (
              <div
                className={cn(
                  "flex size-10 shrink-0 select-none items-center justify-center rounded-full text-xs font-bold",
                  meta.avatarClass
                )}
              >
                {author.avatar}
              </div>
            )}

            <div className="min-w-0 flex-1">
              {/* 헤더: 이름 · 인증 · 핸들 · 날짜 */}
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm leading-tight">
                {/* 공시는 작성자 이름=종목명이므로 이름 자체를 시세 링크로,
                    정식 뉴스는 매체명을 해당 매체 모아보기 페이지로 링크 */}
                {stockAccount && !compact ? (
                  <Link
                    href={`/stocks/${n.stockCode}`}
                    className="font-semibold text-foreground hover:underline"
                  >
                    {author.name}
                  </Link>
                ) : author.outletSlug && !compact ? (
                  <Link
                    href={`/news/outlet/${author.outletSlug}`}
                    className="font-semibold text-foreground hover:underline"
                  >
                    {author.name}
                  </Link>
                ) : (
                  <span className="font-semibold text-foreground">{author.name}</span>
                )}
                {meta.verified && (
                  <BadgeCheck className={cn("size-4 shrink-0", meta.checkClass)} />
                )}
                {meta.label && (
                  <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium leading-none text-muted-foreground">
                    {meta.label}
                  </span>
                )}
                <span className="truncate text-muted-foreground">{author.handle}</span>
                <span className="text-muted-foreground">·</span>
                <span className="shrink-0 text-muted-foreground">{formatPublishedAt(n.publishedAt)}</span>
              </div>

              {/* 본문 */}
              <h3 className="mt-1 font-medium leading-snug text-foreground">{n.title}</h3>
              {!compact && (
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {n.body}
                </p>
              )}

              {/* 푸터: 캐시태그 (클릭 시 해당 종목 시세 화면으로 이동) */}
              {/* compact은 이미 해당 종목 상세 / 공시는 이름이 곧 링크이므로 생략 */}
              {!compact && !stockAccount && n.stockCode && n.stockName && (
                <div className="mt-2 text-xs">
                  <Link
                    href={`/stocks/${n.stockCode}`}
                    className="font-medium text-primary-accent hover:underline"
                  >
                    ${n.stockName}
                  </Link>
                </div>
              )}

              {/* 반응 — 전 등급 엄지업/엄지다운 (아이콘만, 라벨 없음) */}
              {!compact && (
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={() => react(n, "up")}
                    aria-label={n.myReaction === "up" ? "엄지업 취소" : "엄지업"}
                    className={cn(
                      "inline-flex items-center gap-1 text-xs transition-colors",
                      n.myReaction === "up"
                        ? "text-primary-accent"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ThumbsUp
                      className={cn("size-3.5", n.myReaction === "up" && "fill-current")}
                    />
                    {n.upCount > 0 && <span>{n.upCount}</span>}
                  </button>
                  <button
                    onClick={() => react(n, "down")}
                    aria-label={n.myReaction === "down" ? "엄지다운 취소" : "엄지다운"}
                    className={cn(
                      "inline-flex items-center gap-1 text-xs transition-colors",
                      n.myReaction === "down"
                        ? "text-destructive"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ThumbsDown
                      className={cn("size-3.5", n.myReaction === "down" && "fill-current")}
                    />
                    {n.downCount > 0 && <span>{n.downCount}</span>}
                  </button>
                </div>
              )}
            </div>
          </article>
        );
      })}
      {/* 다음 페이지가 있을 때만 마지막 블록에 더 보기 노출 */}
      {!compact && isLast && data?.hasMore && onMore && (
        <div className="flex justify-center py-1">
          <Button variant="ghost" size="sm" onClick={onMore}>
            더 보기
          </Button>
        </div>
      )}
    </div>
  );
}

function PostSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-3",
        compact ? "py-3.5" : "rounded-xl border border-border bg-card px-4 py-3.5"
      )}
    >
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2 py-0.5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
  );
}

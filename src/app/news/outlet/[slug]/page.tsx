"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import { NewsList } from "@/components/news/NewsList";
import { outletBySlug } from "@/lib/news/outlets";

// 매체별 뉴스 모아보기 (T-503 확장): 정식 뉴스 매체 계정 페이지
export default function NewsOutletPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const outlet = outletBySlug(slug);
  const [pages, setPages] = useState(1);

  // 탭 타이틀 = "나라카증권 | 매체명" (client 페이지라 document.title로 지정)
  useEffect(() => {
    if (outlet) document.title = `나라카증권 | ${outlet.name}`;
  }, [outlet]);

  if (!outlet) {
    return (
      <p className="py-12 text-center text-muted-foreground">없는 매체입니다</p>
    );
  }

  return (
    <div className="flex flex-col">
      {/* 매체 헤더 — 상단 고정 (프로필 상단바 감성) */}
      <div className="sticky top-14 z-20 -mx-4 border-b border-border bg-background/80 px-4 pb-3 pt-1 backdrop-blur">
        <Link
          href="/news"
          className="inline-flex items-center gap-1 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          소식통
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
            <Image
              src={outlet.logo}
              alt={outlet.name}
              width={48}
              height={48}
              className="size-10 object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-lg font-bold">{outlet.name}</h1>
              <BadgeCheck className="size-4 shrink-0 text-primary-accent" />
            </div>
            <p className="text-sm text-muted-foreground">{outlet.handle}</p>
          </div>
        </div>
      </div>

      {/* 해당 매체 뉴스 피드 (누적 페이지네이션) */}
      <div className="mt-4 flex flex-col gap-3">
        {Array.from({ length: pages }, (_, i) => (
          <NewsList
            key={i}
            outlet={outlet.slug}
            page={i + 1}
            isLast={i + 1 === pages}
            onMore={() => setPages((p) => p + 1)}
          />
        ))}
      </div>

      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        정식 뉴스도 가끔 틀립니다
      </p>
    </div>
  );
}

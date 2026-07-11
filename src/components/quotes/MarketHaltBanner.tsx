"use client";

import { useQuotes } from "@/hooks/useQuotes";

// 서킷브레이커 전체 경고 배너 (T-405) — 발동 중에만 렌더
export function MarketHaltBanner() {
  const { data } = useQuotes();
  if (data?.marketState !== "halted") return null;

  const until = data.haltedUntil
    ? new Date(data.haltedUntil).toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="sticky top-14 z-30 animate-pulse border-b border-destructive bg-destructive/20 px-4 py-2 text-center text-sm font-medium text-destructive-foreground">
      ⚡ 서킷브레이커 발동 — 전 종목 거래 정지{until ? ` (${until} 해제 예정)` : ""}
    </div>
  );
}

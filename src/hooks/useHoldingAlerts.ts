"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getJson } from "@/lib/api/client";
import { playAlertSound } from "@/lib/sound";
import { useSettingsStore } from "@/lib/settingsStore";
import { useQuotes } from "@/hooks/useQuotes";
import type { Portfolio } from "@/types/domain";

// 보유 종목의 전일 대비 등락률이 10% 구간(데실)을 넘나들 때 토스트 알림.
// 구간 = trunc(등락률 / 10). 예: +12% → 1, -15% → -1, +23% → 2.
// 마지막으로 알린 구간을 날짜별로 localStorage에 저장해 새로고침·재방문 시 중복 알림을 막는다.

const STORAGE_KEY = "naraka-holding-alert-buckets";

interface StoredBuckets {
  date: string; // YYYY-MM-DD (KST)
  buckets: Record<string, number>; // 종목코드 → 마지막 구간
}

function todayKst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

function loadBuckets(date: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const stored = JSON.parse(raw) as StoredBuckets;
    return stored.date === date ? stored.buckets : {};
  } catch {
    return {};
  }
}

function saveBuckets(date: string, buckets: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date, buckets } satisfies StoredBuckets));
  } catch {
    // 저장 실패는 무시 (다음 틱에 재시도)
  }
}

export function useHoldingAlerts() {
  const alertsEnabled = useSettingsStore((s) => s.alertsEnabled);

  // 비로그인이면 실패(retry 없음) → 워처 비활성. 보유 목록은 체결 시 invalidate로 갱신된다.
  const { data: portfolio } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => getJson<Portfolio>("/api/portfolio"),
    retry: false,
    refetchInterval: 5 * 60_000,
  });

  const { data: board } = useQuotes();

  useEffect(() => {
    if (!portfolio || !board || portfolio.holdings.length === 0) return;

    const date = todayKst();
    const buckets = loadBuckets(date);
    let changed = false;
    let alerted = false;

    for (const holding of portfolio.holdings) {
      const quote = board.quotes.find((q) => q.code === holding.stockCode);
      if (!quote) continue;

      const bucket = Math.trunc(quote.changePercent / 10);
      const prev = buckets[holding.stockCode];

      if (prev === undefined) {
        // 오늘 첫 관측은 기준만 기록 (접속 시점에 이미 +23%여도 소급 알림하지 않음)
        buckets[holding.stockCode] = bucket;
        changed = true;
        continue;
      }
      if (bucket === prev) continue;

      buckets[holding.stockCode] = bucket;
      changed = true;

      if (alertsEnabled) {
        const rose = bucket > prev;
        const pct = quote.changePercent;
        const formatted = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
        toast(`${holding.stockName} ${rose ? "상승" : "하락"} 알림`, {
          description: `전일 대비 ${formatted} — 10% 구간을 ${rose ? "넘어섰어요" : "내려갔어요"}`,
        });
        alerted = true;
      }
    }

    if (changed) saveBuckets(date, buckets);
    if (alerted) playAlertSound();
  }, [portfolio, board, alertsEnabled]);
}

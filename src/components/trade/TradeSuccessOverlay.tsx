"use client";

import { useEffect, useRef } from "react";
import { formatMoney, formatQty } from "@/lib/market";

export interface TradeSuccessInfo {
  side: "buy" | "sell";
  stockName: string;
  quantity: number;
  price: number; // 서버 체결 단가
}

// 미니 폭죽 파편 (결정적 배치 — 렌더마다 흔들리지 않게 고정 시드)
const CONFETTI = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2;
  const dist = 70 + (i % 4) * 22;
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist - 20),
    rot: 180 + i * 40,
    color: ["var(--bull)", "var(--bear)", "oklch(0.8 0.16 85)", "oklch(0.72 0.19 145)"][i % 4],
    size: i % 3 === 0 ? 7 : 5,
  };
});

// 체결 완료 팝업 (토스 벤치마킹): 체크 드로우 + 미니 폭죽. 2초 뒤 자동 닫힘.
export function TradeSuccessOverlay({
  info,
  onClose,
}: {
  info: TradeSuccessInfo | null;
  onClose: () => void;
}) {
  // 부모가 재렌더될 때마다 새 onClose가 내려와도 타이머가 리셋되지 않게 ref로 고정
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!info) return;
    const timer = setTimeout(() => onCloseRef.current(), 2000);
    return () => clearTimeout(timer);
  }, [info]);

  if (!info) return null;

  return (
    <div
      role="status"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
    >
      <div className="animate-trade-pop relative flex flex-col items-center gap-3 rounded-2xl border bg-card px-10 py-8 shadow-xl">
        {/* 미니 폭죽 */}
        <div className="pointer-events-none absolute left-1/2 top-1/3">
          {CONFETTI.map((p, i) => (
            <span
              key={i}
              className="animate-confetti absolute rounded-[2px]"
              style={{
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                ["--dx" as string]: `${p.dx}px`,
                ["--dy" as string]: `${p.dy}px`,
                ["--rot" as string]: `${p.rot}deg`,
              }}
            />
          ))}
        </div>

        {/* 초록 체크 드로우 */}
        <div className="flex size-16 items-center justify-center rounded-full bg-[oklch(0.72_0.19_145)]/15">
          <svg viewBox="0 0 32 32" className="size-9" fill="none" aria-hidden>
            <path
              d="M7 17 L13.5 23.5 L25 10"
              stroke="oklch(0.72 0.19 145)"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-check-draw"
            />
          </svg>
        </div>

        <p className="text-lg font-bold">체결 완료!</p>
        <p className="text-sm text-muted-foreground">
          {info.stockName} {formatQty(info.quantity)}주 ×{" "}
          {formatMoney(info.price)} {info.side === "buy" ? "구매" : "판매"}
        </p>
      </div>
    </div>
  );
}

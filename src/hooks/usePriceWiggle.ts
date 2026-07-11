"use client";

import { useEffect, useState } from "react";

// 틱 사이 가격 미세 진동 연출 (T-403)
// 순수하게 표시용 눈속임이다 — 체결가는 항상 서버 틱 값 (아키텍처 원칙 4).
export function usePriceWiggle(price: number, enabled: boolean): number {
  // 어떤 기준가에서 만든 진동인지 함께 저장해, 기준가가 바뀌면 자연히 무효화한다
  const [wiggle, setWiggle] = useState<{ base: number; value: number } | null>(null);

  useEffect(() => {
    if (!enabled || price <= 0) return;

    const timer = setInterval(() => {
      const factor = 1 + (Math.random() - 0.5) * 0.002; // ±0.1%
      const next = Math.round(price * factor);
      setWiggle({
        base: price,
        value: price >= 1000 ? Math.round(next / 10) * 10 : next,
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [price, enabled]);

  return enabled && wiggle?.base === price ? wiggle.value : price;
}

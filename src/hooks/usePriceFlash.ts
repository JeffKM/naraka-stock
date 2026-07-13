"use client";

import { useEffect, useRef, useState } from "react";

export interface PriceFlash {
  direction: "up" | "down" | null; // 마지막 변동 방향
  seq: number; // 변동 횟수 — key로 써서 배경 플래시 애니메이션 재발동
}

// 표시 가격이 바뀔 때 등락 방향 배경 플래시 신호 (토스 벤치마킹).
// 상승이면 연한 빨강, 하락이면 연한 파랑 배경이 켜졌다 서서히 사라진다.
// seq를 요소 key로 걸어 같은 방향 연속 변동에도 애니메이션이 재시작된다.
export function usePriceFlash(value: number): PriceFlash {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState<PriceFlash>({ direction: null, seq: 0 });

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === value) return;
    prevRef.current = value;
    setFlash((f) => ({ direction: value > prev ? "up" : "down", seq: f.seq + 1 }));
  }, [value]);

  return flash;
}

"use client";

import { useEffect, useRef, useState } from "react";

export interface CountUp {
  display: number; // 화면에 보여줄 중간값
  direction: "up" | "down" | null; // 마지막 변동 방향 (플래시 연출용)
  seq: number; // 변동 횟수 — key로 써서 플래시 애니메이션 재발동
}

// 숫자가 툭 바뀌지 않고 르르륵 굴러가게 하는 카운트업 (토스 벤치마킹).
// 5분 틱 갱신처럼 값이 바뀔 때만 animation frame으로 보간한다. 표시 전용 —
// 실제 금액은 항상 서버 값이며, 애니메이션이 끝나면 정확히 target에 수렴한다.
export function useCountUp(target: number, duration = 900): CountUp {
  const [display, setDisplay] = useState(target);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  const [seq, setSeq] = useState(0);
  const prevRef = useRef(target);
  const frameRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    if (from === target) return;
    prevRef.current = target;
    setDirection(target > from ? "up" : "down");
    setSeq((s) => s + 1);

    cancelAnimationFrame(frameRef.current);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      setDisplay(Math.round(from + (target - from) * eased));
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return { display, direction, seq };
}

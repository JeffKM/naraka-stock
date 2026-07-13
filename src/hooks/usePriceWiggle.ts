"use client";

import { useEffect, useState } from "react";

// 틱 사이 가격 미세 진동 연출 (T-403)
// 순수하게 표시용 눈속임이다 — 체결가는 항상 서버 틱 값 (아키텍처 원칙 4).

const WIGGLE_INTERVAL_MS = 2500;

// 공통 진동 로직 — quantize로 원 단위/지수 소수점 등 자릿수만 다르게 처리한다.
// 시작 시점을 무작위로 흩뜨려 전 종목이 정확히 동시에 깜빡이지 않게 한다.
function useWiggle(
  base: number,
  enabled: boolean,
  quantize: (v: number) => number
): number {
  // 어떤 기준가에서 만든 진동인지 함께 저장해, 기준가가 바뀌면 자연히 무효화한다
  const [wiggle, setWiggle] = useState<{ base: number; value: number } | null>(null);

  useEffect(() => {
    if (!enabled || base <= 0) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    const kickoff = setTimeout(() => {
      const tick = () => {
        const factor = 1 + (Math.random() - 0.5) * 0.002; // ±0.1%
        setWiggle({ base, value: quantize(base * factor) });
      };
      tick();
      timer = setInterval(tick, WIGGLE_INTERVAL_MS);
    }, Math.random() * WIGGLE_INTERVAL_MS);

    return () => {
      clearTimeout(kickoff);
      if (timer) clearInterval(timer);
    };
  }, [base, enabled, quantize]);

  return enabled && wiggle?.base === base ? wiggle.value : base;
}

// 원 단위 가격: 1,000원 이상은 10원 단위로 반올림
function quantizeWon(v: number): number {
  return v >= 1000 ? Math.round(v / 10) * 10 : Math.round(v);
}

// 지수: 소수 2자리 (indexService와 동일 자릿수)
function quantizeIndex(v: number): number {
  return Math.round(v * 100) / 100;
}

export function usePriceWiggle(price: number, enabled: boolean): number {
  return useWiggle(price, enabled, quantizeWon);
}

export function useIndexWiggle(value: number, enabled: boolean): number {
  return useWiggle(value, enabled, quantizeIndex);
}

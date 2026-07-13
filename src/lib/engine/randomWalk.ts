// 일일 가격 경로 생성기 (T-201) + VI 구간 마킹 (T-203)
//
// - 기하 랜덤워크: 틱마다 price *= exp(드리프트 + 변동성·z)
// - 드리프트: 편향 bias%가 하루 전체에 걸쳐 반영되도록 ln(1+bias/100)/틱수
// - 클램프: 직전 개장일 종가 ±30% (상한가/하한가)
// - VI: 직전 틱 대비 ±6% 급변 → 다음 1틱(5분) 거래정지
// - 틱 수는 장 시간에 따라 가변 (기본 84 = 15~22시). 틱 수가 달라져도
//   "하루" 변동성·점프 빈도가 유지되도록 √스케일/비율 보정한다 — 밸런스
//   튜닝(T-701)은 84틱 기준이므로 이 보정이 없으면 장이 길수록 과열된다.

import type { StockTier } from "@/types/domain";
import { TICKS_PER_DAY } from "@/lib/market";
import { nextGaussian, type Rng } from "./rng";

// 등급별 틱당 변동성 (일일 변동폭 목표: 안정 ±1~5% / 일반 ±3~15% / 잡주 ±10~30%)
const TICK_SIGMA: Record<StockTier, number> = {
  stable: 0.0018,
  normal: 0.006,
  wild: 0.014,
};

export const PRICE_LIMIT_RATE = 0.3; // 상하한 ±30%

// 점프(급등락 이벤트): 랜덤워크만으로는 틱 단위 급변이 없어 차트가 밋밋하고
// VI가 발동하지 않는다. 낮은 확률로 한 틱에 2~7% 점프를 주입한다 (연출 + VI 재료).
const JUMP_PROBABILITY: Record<StockTier, number> = {
  stable: 0.002,
  normal: 0.005,
  wild: 0.015,
};
const JUMP_MIN = 0.02;
const JUMP_MAX = 0.07;

// VI: 직전 틱 대비 ±6% 이상 급변 → 다음 1틱(5분) 거래정지
// (PRD 초안 "10분 내 ±10%"는 현 변동성에서 발동 확률 0이라 시뮬레이션 후 조정)
const VI_THRESHOLD = 0.06;
const VI_HALT_TICKS = 1;

export interface Tick {
  tickIndex: number;
  price: number;
  isHalted: boolean;
}

export interface DailyPath {
  ticks: Tick[];
  open: number;
  high: number;
  low: number;
  close: number;
}

// 가격 반올림: 정수 원, 1,000원 이상은 10원 단위 호가 느낌으로
function roundPrice(price: number): number {
  if (price >= 1000) return Math.round(price / 10) * 10;
  return Math.max(1, Math.round(price));
}

export function generateDailyPath(
  prevClose: number,
  bias: number, // %p (-30~+30, 0=중립)
  tier: StockTier,
  rng: Rng,
  totalTicks: number = TICKS_PER_DAY
): DailyPath {
  const upperLimit = roundPrice(prevClose * (1 + PRICE_LIMIT_RATE));
  const lowerLimit = roundPrice(prevClose * (1 - PRICE_LIMIT_RATE));
  const driftPerTick = Math.log(1 + bias / 100) / totalTicks;
  // 하루 변동성 보존: 틱이 많아져도 σ_일 = σ_틱·√틱수 가 84틱 기준과 같도록
  const sigma = TICK_SIGMA[tier] * Math.sqrt(TICKS_PER_DAY / totalTicks);
  // 하루 점프 기대 횟수 보존
  const jumpProbability = JUMP_PROBABILITY[tier] * (TICKS_PER_DAY / totalTicks);

  const prices: number[] = [];
  let price = prevClose;
  for (let i = 0; i < totalTicks; i++) {
    price *= Math.exp(driftPerTick + sigma * nextGaussian(rng));
    // 확률적 점프 (방향 50:50)
    if (rng() < jumpProbability) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < 0.5 ? 1 + size : 1 - size;
    }
    price = Math.min(Math.max(price, lowerLimit), upperLimit);
    prices.push(roundPrice(price));
  }

  // VI 마킹: 직전 틱 대비 ±6% 이상 급변 → 다음 틱부터 5분 정지
  const halted = new Array<boolean>(totalTicks).fill(false);
  for (let i = 0; i < totalTicks; i++) {
    const base = i === 0 ? prevClose : prices[i - 1];
    if (Math.abs(prices[i] - base) / base >= VI_THRESHOLD) {
      for (let j = i + 1; j <= i + VI_HALT_TICKS && j < totalTicks; j++) {
        halted[j] = true;
      }
    }
  }

  const ticks: Tick[] = prices.map((p, i) => ({
    tickIndex: i,
    price: p,
    isHalted: halted[i],
  }));

  return {
    ticks,
    open: prices[0],
    high: Math.max(...prices),
    low: Math.min(...prices),
    close: prices[totalTicks - 1],
  };
}

// 시세 조정용: 오늘 경로의 남은 구간(fromTick 이후)만 재생성 (T-604)
// bias는 biasTicks 구간(null이면 남은 시간 전체)에 걸리는 드리프트로 작용하고,
// 구간이 끝나면 resumeBias(그날 추첨 편향)의 하루 드리프트로 복귀한다.
// 상하한은 원래 기준가 유지.
export function regenerateRemainingPath(
  prevClose: number, // 오늘 상하한 기준 (직전 개장일 종가)
  currentPrice: number, // 현재 틱 가격 (여기서부터 이어간다)
  fromTick: number, // 현재 틱 인덱스 — 이후 틱(fromTick+1..끝)을 새로 만든다
  bias: number,
  tier: StockTier,
  rng: Rng,
  totalTicks: number = TICKS_PER_DAY,
  biasTicks: number | null = null, // 편향이 걸리는 틱 수 (null = 남은 전체)
  resumeBias: number = 0 // 창 종료 후 복귀할 편향 (%p, 하루 전체 기준 드리프트)
): Tick[] {
  const upperLimit = roundPrice(prevClose * (1 + PRICE_LIMIT_RATE));
  const lowerLimit = roundPrice(prevClose * (1 - PRICE_LIMIT_RATE));
  const remaining = totalTicks - 1 - fromTick;
  if (remaining <= 0) return [];

  const windowTicks =
    biasTicks === null ? remaining : Math.min(Math.max(biasTicks, 1), remaining);
  const driftPerTick = Math.log(1 + bias / 100) / windowTicks;
  // 복귀 드리프트는 원래 경로와 같은 틱당 비율 (하루 전체에 편향을 편 값)
  const resumeDriftPerTick = Math.log(1 + resumeBias / 100) / totalTicks;
  const sigma = TICK_SIGMA[tier] * Math.sqrt(TICKS_PER_DAY / totalTicks);
  const jumpProbability = JUMP_PROBABILITY[tier] * (TICKS_PER_DAY / totalTicks);

  const ticks: Tick[] = [];
  let price = currentPrice;
  for (let i = fromTick + 1; i < totalTicks; i++) {
    const drift = i - fromTick <= windowTicks ? driftPerTick : resumeDriftPerTick;
    price *= Math.exp(drift + sigma * nextGaussian(rng));
    if (rng() < jumpProbability) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < 0.5 ? 1 + size : 1 - size;
    }
    price = Math.min(Math.max(price, lowerLimit), upperLimit);
    ticks.push({ tickIndex: i, price: roundPrice(price), isHalted: false });
  }

  // VI 마킹 (직전 틱 대비 ±6% → 다음 틱 정지, 재생성 구간 내에서만)
  for (let i = 0; i < ticks.length; i++) {
    const base = i === 0 ? currentPrice : ticks[i - 1].price;
    if (Math.abs(ticks[i].price - base) / base >= VI_THRESHOLD && i + 1 < ticks.length) {
      ticks[i + 1].isHalted = true;
    }
  }

  return ticks;
}

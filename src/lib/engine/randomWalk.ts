// 일일 84틱 가격 경로 생성기 (T-201) + VI 구간 마킹 (T-203)
//
// - 기하 랜덤워크: 틱마다 price *= exp(드리프트 + 변동성·z)
// - 드리프트: 편향 bias%가 하루 전체에 걸쳐 반영되도록 ln(1+bias/100)/84
// - 클램프: 직전 개장일 종가 ±30% (상한가/하한가)
// - VI: 10분(2틱) 내 ±10% 이상 변동 → 다음 1틱(5분) 거래정지

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
  rng: Rng
): DailyPath {
  const upperLimit = roundPrice(prevClose * (1 + PRICE_LIMIT_RATE));
  const lowerLimit = roundPrice(prevClose * (1 - PRICE_LIMIT_RATE));
  const driftPerTick = Math.log(1 + bias / 100) / TICKS_PER_DAY;
  const sigma = TICK_SIGMA[tier];

  const prices: number[] = [];
  let price = prevClose;
  for (let i = 0; i < TICKS_PER_DAY; i++) {
    price *= Math.exp(driftPerTick + sigma * nextGaussian(rng));
    // 확률적 점프 (방향 50:50)
    if (rng() < JUMP_PROBABILITY[tier]) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < 0.5 ? 1 + size : 1 - size;
    }
    price = Math.min(Math.max(price, lowerLimit), upperLimit);
    prices.push(roundPrice(price));
  }

  // VI 마킹: 직전 틱 대비 ±6% 이상 급변 → 다음 틱부터 5분 정지
  const halted = new Array<boolean>(TICKS_PER_DAY).fill(false);
  for (let i = 0; i < TICKS_PER_DAY; i++) {
    const base = i === 0 ? prevClose : prices[i - 1];
    if (Math.abs(prices[i] - base) / base >= VI_THRESHOLD) {
      for (let j = i + 1; j <= i + VI_HALT_TICKS && j < TICKS_PER_DAY; j++) {
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
    close: prices[TICKS_PER_DAY - 1],
  };
}

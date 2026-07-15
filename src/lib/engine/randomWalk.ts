// 일일 가격 경로 생성기 (T-201) + VI 구간 마킹 (T-203)
//
// - 기하 랜덤워크(현실형): 틱마다 price *= exp(드리프트 + 변동성·z)
//   장중 가격과 종가가 함께 움직이는 실제 시장형. 평균회귀(OU)를 쓰지 않는 이유는,
//   "장중 크게·종가 얌전"이라는 인위적 되돌림이 지정가 예약주문의 무손실 차익거래
//   (저점매수→반등매도)를 만들기 때문(시뮬레이션 검증 2026-07-15). 랜덤워크는
//   되돌림 보장이 없어 그 브라켓 전략이 스스로 손실을 내 자멸한다.
// - 드리프트: (편향 bias% + 등급 기본 드리프트)가 하루 전체에 걸쳐 반영. 기본
//   드리프트는 등급별 "오를 확률" 편향(우량 우상향).
// - 클램프: 직전 개장일 종가 ±30% (상한가/하한가)
// - VI: 직전 틱 대비 ±8% 급변 → 다음 1틱(5분) 거래정지 (랜덤워크에선 틱 σ가 작아
//   주로 점프가 겹칠 때만 발동 = 드문 서킷)
// - 틱 수는 장 시간에 따라 가변 (기본 84 = 15~22시). 틱 수가 달라져도 "하루"
//   변동성·점프 빈도가 유지되도록 σ ∝ √(84/틱수), 점프빈도 ∝ (84/틱수)로 보정한다.

import type { StockTier } from "@/types/domain";
import { TICKS_PER_DAY } from "@/lib/market";
import { nextGaussian, type Rng } from "./rng";

// 등급별 틱당 변동성 — 종가·장중이 함께 커지는 현실형. 생동감 있게 튜닝하되
// 등급 순서 유지(2026-07-15 재튜닝). 우량도 월 3일쯤 두 자릿수 등락이 나온다.
const TICK_SIGMA: Record<StockTier, number> = {
  stable: 0.005,
  normal: 0.009,
  wild: 0.015,
};

// 등급별 기본 일일 드리프트(%/일). 편향과 합산돼 하루 드리프트로 반영된다.
// 우량주에 양(+)의 드리프트를 줘 "오를 확률"을 일반·잡주보다 높인다(우상향).
const DAILY_DRIFT: Record<StockTier, number> = {
  stable: 0.2,
  normal: 0,
  wild: -0.2,
};

export const PRICE_LIMIT_RATE = 0.3; // 상하한 ±30%

// --- 리얼리티 개선 상수 (2026-07-16, 경로 생성 층위) ---
// σ = TICK_SIGMA·sqrt(scale)·intraday·cluster·regime. 전부 방향중립(σ만 스케일).
const INTRADAY_U_AMPLITUDE = 0.8; // U자 진폭 (개장·마감 대비 정오)

// 변동성 클러스터링 (GARCH-lite): 지속성 상태 h를 AR(1)로 진화시켜
// "험한 구간이 뭉쳐서" 오게 한다. 충격은 방향중립(중심화된 |가우시안|).
const CLUSTER_RHO = 0.9; // 클러스터링 지속성 (AR(1))
const CLUSTER_ETA = 0.15; // 충격 감도
const CLUSTER_MIN = 0.5;
const CLUSTER_MAX = 2.5;
const MEAN_ABS_GAUSSIAN = Math.sqrt(2 / Math.PI); // E[|Z|] — 충격 중심화용

// 점프(급등락 이벤트): 랜덤워크만으로는 틱 단위 급변이 없어 차트가 밋밋하고 VI가
// 발동하지 않는다. 낮은 확률로 한 틱에 2~7% 점프를 주입한다 (연출 + VI 재료).
const JUMP_PROBABILITY: Record<StockTier, number> = {
  stable: 0.004,
  normal: 0.006,
  wild: 0.015,
};
const JUMP_MIN = 0.02;
const JUMP_MAX = 0.07;
const AFTERSHOCK_BOOST = 0.8; // 점프 후 클러스터링 상태 부스트 (여진)

// VI: 직전 틱 대비 ±8% 이상 급변 → 다음 1틱(5분) 거래정지 (등급 무관 단일 임계값)
const VI_THRESHOLD = 0.08;
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
  // 편향 + 등급 기본 드리프트를 하루 전체에 편다
  const driftPerTick = Math.log(1 + (bias + DAILY_DRIFT[tier]) / 100) / totalTicks;
  // 틱 수 보정: 하루 변동성·점프 기대 횟수를 84틱 기준과 같게 유지
  const scale = TICKS_PER_DAY / totalTicks;
  const baseSigma = TICK_SIGMA[tier] * Math.sqrt(scale);
  const jumpProbability = JUMP_PROBABILITY[tier] * scale;
  const intraday = intradayProfile(totalTicks);
  let h = 1; // 클러스터링 상태 (틱 간 지속)

  const prices: number[] = [];
  let price = prevClose;
  for (let i = 0; i < totalTicks; i++) {
    const sigma = baseSigma * intraday[i] * h;
    price *= Math.exp(driftPerTick + sigma * nextGaussian(rng));
    // 다음 틱 σ에 반영될 상태 진화 (중심화된 |가우시안| 충격 → 방향중립)
    h = clusterStep(h, Math.abs(nextGaussian(rng)) - MEAN_ABS_GAUSSIAN);
    // 확률적 점프 (방향 50:50)
    if (rng() < jumpProbability) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < 0.5 ? 1 + size : 1 - size;
      h = clusterBoost(h); // 여진: 다음 틱들 σ 상승
    }
    price = Math.min(Math.max(price, lowerLimit), upperLimit);
    prices.push(roundPrice(price));
  }

  // VI 마킹: 직전 틱 대비 ±8% 이상 급변 → 다음 틱부터 5분 정지
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
// 등급 기본 드리프트는 전 구간에 계속 적용. 상하한은 원래 기준가 유지.
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
  const scale = TICKS_PER_DAY / totalTicks;
  const sigma = TICK_SIGMA[tier] * Math.sqrt(scale);
  const jumpProbability = JUMP_PROBABILITY[tier] * scale;
  // 틱당 드리프트: 등급 기본(항상) + 창 안은 bias, 창 밖은 resumeBias
  const baseDriftPerTick = Math.log(1 + DAILY_DRIFT[tier] / 100) / totalTicks;
  const windowDriftPerTick = Math.log(1 + bias / 100) / windowTicks;
  const resumeDriftPerTick = Math.log(1 + resumeBias / 100) / totalTicks;

  const ticks: Tick[] = [];
  const prices: number[] = [];
  let price = currentPrice;
  for (let i = fromTick + 1; i < totalTicks; i++) {
    const inWindow = i - fromTick <= windowTicks;
    const drift = baseDriftPerTick + (inWindow ? windowDriftPerTick : resumeDriftPerTick);
    price *= Math.exp(drift + sigma * nextGaussian(rng));
    if (rng() < jumpProbability) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < 0.5 ? 1 + size : 1 - size;
    }
    price = Math.min(Math.max(price, lowerLimit), upperLimit);
    const rounded = roundPrice(price);
    prices.push(rounded);
    ticks.push({ tickIndex: i, price: rounded, isHalted: false });
  }

  // VI 마킹 (직전 틱 대비 ±8% → 다음 틱 정지, 재생성 구간 내에서만)
  for (let i = 0; i < ticks.length; i++) {
    const base = i === 0 ? currentPrice : prices[i - 1];
    if (Math.abs(prices[i] - base) / base >= VI_THRESHOLD && i + 1 < ticks.length) {
      ticks[i + 1].isHalted = true;
    }
  }

  return ticks;
}

// 인트라데이 U자 변동성 배율 — 개장·마감↑·정오↓. 구간 평균을 정확히 1로
// 정규화해 하루 총변동성을 보존한다(방향 무관, RNG 미소비).
export function intradayProfile(totalTicks: number): number[] {
  if (totalTicks <= 1) return [1];
  const raw = Array.from({ length: totalTicks }, (_, i) => {
    const t = i / (totalTicks - 1); // 0..1
    return 1 + INTRADAY_U_AMPLITUDE * (2 * t - 1) ** 2;
  });
  const mean = raw.reduce((a, b) => a + b, 0) / totalTicks;
  return raw.map((r) => r / mean);
}

// 변동성 클러스터링 상태 갱신 (AR(1) + 클램프). shock은 중심화된 |가우시안|이라
// 평균 0 → E[h]≈1(총변동성 보존). σ 배율만 → 방향중립.
export function clusterStep(h: number, shock: number): number {
  const next = 1 + CLUSTER_RHO * (h - 1) + CLUSTER_ETA * shock;
  return Math.min(CLUSTER_MAX, Math.max(CLUSTER_MIN, next));
}

// 점프 여진: 점프 직후 클러스터링 상태를 일시 부스트(이후 AR(1)로 감쇠).
export function clusterBoost(h: number): number {
  return Math.min(CLUSTER_MAX, h + AFTERSHOCK_BOOST);
}

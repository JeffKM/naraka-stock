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
import { nextGaussian, createRng, hashSeed, type Rng } from "./rng";

// 등급별 틱당 변동성 — 종가·장중이 함께 커지는 현실형. 생동감 있게 튜닝하되
// 등급 순서 유지(2026-07-15 재튜닝). 우량도 월 3일쯤 두 자릿수 등락이 나온다.
const TICK_SIGMA: Record<StockTier, number> = {
  stable: 0.005,
  normal: 0.009,
  wild: 0.015,
};

// 등급별 기본 일일 드리프트(%/일). 편향과 합산돼 하루 드리프트로 반영된다.
// 우량주에 양(+)의 드리프트를 줘 "오를 확률"을 일반·잡주보다 높인다(우상향).
// wild은 시뮬 튜닝용 env 오버라이드(SIM_WILD_DRIFT). 운영값 -1.0 = "실력자 우승"
// 밸런스 반영(2026-07-20, -0.2→-1.0). 잡주 하방을 키워 도박(블라인드 몰빵) 꼬리를 깎되,
// 급락트랩이 되지 않게 완화값(-1.5 대신) 채택. env 미설정 시 -1.0.
const DAILY_DRIFT: Record<StockTier, number> = {
  stable: 0.2,
  normal: 0,
  wild: Number(process.env.SIM_WILD_DRIFT ?? -1.0),
};

// 점프 방향(상승) 확률 — stable·normal은 50:50 대칭. wild만 env로 하방편향(SIM_WILD_JUMP_UP_PROB).
// 낮추면 잡주 급락(크래시)이 잦아져 좌측 꼬리가 두꺼워진다 = 블라인드 몰빵 파산 유도.
// 운영값 0.35(35:65) = "실력자 우승" 밸런스 반영(2026-07-20, 0.5→0.35, 복권성 보존 완화값).
const JUMP_UP_PROBABILITY: Record<StockTier, number> = {
  stable: 0.5,
  normal: 0.5,
  wild: Number(process.env.SIM_WILD_JUMP_UP_PROB ?? 0.35),
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

// 레짐: σ 배율만(방향중립). 하루 시작 시 등급별 추첨.
const REGIME_MULT = { calm: 0.7, normal: 1.0, stormy: 1.6 } as const;

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

// 거래량 생성 (피드백 5): baseline(등급) × (1 + k·|가격변동률|) × noise.
// 단순 변동폭 비례가 아니라 등급 baseline을 곱해 "꾸준히 활발한 대형주 vs 가끔 터지는
// 잡주"라는 독자적 정보를 만든다 → 거래량 순위가 등락 순위와 겹치지 않는다.
const VOLUME_BASELINE: Record<StockTier, number> = {
  stable: 8000, // 대형주: 꾸준히 높은 기본 유동성
  normal: 3000,
  wild: 1200, // 잡주: 평소 한산, 변동 시 스파이크
};
const VOLUME_MOVE_K = 40; // |틱 변동률|(0~)에 대한 거래량 스파이크 계수
const VOLUME_NOISE_MIN = 0.6; // noise 균등분포 [min, max]
const VOLUME_NOISE_MAX = 1.4;

// 종목 고유 거래량 배율 (2026-07-21): 같은 등급이면 baseline이 동일해 종목 간 거래량이
// 서로 수렴("다 비슷비슷") → 종목 code로 결정론적 고정 배율을 곱해 다양성을 준다.
// 로그균등 [0.7, 1.5]. 곱셈적 배율이라 기하적으로 균등하게 뽑는다. 범위를 이 폭으로
// 잡아 등급 baseline 순서를 보존한다: stable[5600,12000] > normal[2100,4500] > wild[840,1800].
// 진위 단서 보존: 이 배율은 정상 경로·헤드페이크 경로 양쪽에 "동일하게" 곱해지므로
// (호출부에서 volumeScale과 곱), "오를 때 거래량이 실리는가/헤드페이크는 자기 평소의 40%"라는
// 시계열 상대 단서는 배율과 독립적으로 유지된다.
const VOLUME_SCALE_MIN = 0.7;
const VOLUME_SCALE_MAX = 1.5;
export function stockVolumeScale(code: string): number {
  const u = createRng(hashSeed(`volscale|${code}`))();
  return Math.exp(
    Math.log(VOLUME_SCALE_MIN) + u * (Math.log(VOLUME_SCALE_MAX) - Math.log(VOLUME_SCALE_MIN))
  );
}

// 틱 거래량: prevPrice→price 변동률과 등급 baseline로 산출. RNG 1 소비(noise).
// adminService의 동결 구간(가격 변화 없는 구간) 채우기에서도 재사용하도록 export.
export function tickVolume(tier: StockTier, prevPrice: number, price: number, rng: Rng): number {
  const moveRate = prevPrice > 0 ? Math.abs(price - prevPrice) / prevPrice : 0;
  const noise = VOLUME_NOISE_MIN + rng() * (VOLUME_NOISE_MAX - VOLUME_NOISE_MIN);
  return Math.max(1, Math.round(VOLUME_BASELINE[tier] * (1 + VOLUME_MOVE_K * moveRate) * noise));
}

// 개장 갭 σ (방향 랜덤·드리프트 없음). 오버나이트 지정가 arb 안전.
export const GAP_SIGMA: Record<StockTier, number> = {
  stable: 0.003,
  normal: 0.005,
  wild: 0.008,
};

// 개장 갭 배율 (RNG 가우시안 1 소비). E[log]=0 → 방향중립.
export function openingGapFactor(tier: StockTier, rng: Rng): number {
  return Math.exp(GAP_SIGMA[tier] * nextGaussian(rng));
}

export interface Tick {
  tickIndex: number;
  price: number;
  isHalted: boolean;
  volume: number;
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
  totalTicks: number = TICKS_PER_DAY,
  volumeScale: number = 1 // 거래량 배율 (Phase 3b 거래량 단서: 조용한 진짜=QUIET_REAL_VOLUME_SCALE)
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
  const regime = pickRegime(tier, rng); // RNG 1 소비 (틱 루프 진입 전)
  let h = 1; // 클러스터링 상태 (틱 간 지속)

  const prices: number[] = [];
  const volumes: number[] = [];
  // 개장 갭 (틱 진입 전 1회, 상하한 클램프)
  let price = Math.min(
    Math.max(prevClose * openingGapFactor(tier, rng), lowerLimit),
    upperLimit
  );
  for (let i = 0; i < totalTicks; i++) {
    const prev = i === 0 ? prevClose : prices[i - 1];
    const sigma = baseSigma * intraday[i] * h * regime.mult;
    price *= Math.exp(driftPerTick + sigma * nextGaussian(rng));
    // 다음 틱 σ에 반영될 상태 진화 (중심화된 |가우시안| 충격 → 방향중립)
    h = clusterStep(h, Math.abs(nextGaussian(rng)) - MEAN_ABS_GAUSSIAN);
    // 확률적 점프 (방향 50:50)
    if (rng() < jumpProbability) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < JUMP_UP_PROBABILITY[tier] ? 1 + size : 1 - size;
      h = clusterBoost(h); // 여진: 다음 틱들 σ 상승
    }
    price = Math.min(Math.max(price, lowerLimit), upperLimit);
    const rounded = roundPrice(price);
    prices.push(rounded);
    // 가격 확정 후 RNG 소비(volumeScale과 무관하게 항상 1회 → 가격·재현성 불변).
    // volumeScale<1은 "조용한 진짜"(거래량 단서를 불완전하게) 연출용.
    volumes.push(Math.max(1, Math.round(tickVolume(tier, prev, rounded, rng) * volumeScale)));
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
    volume: volumes[i],
  }));

  return {
    ticks,
    open: prices[0], // 개장 갭 + 첫 틱 이동이 합성돼 반올림된 값 (순수 갭값 아님)
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
  resumeBias: number = 0, // 창 종료 후 복귀할 편향 (%p, 하루 전체 기준 드리프트)
  volumeScale: number = 1 // 거래량 배율 (종목 고유 배율·단서 배율 합성 — generateDailyPath와 대칭)
): Tick[] {
  const upperLimit = roundPrice(prevClose * (1 + PRICE_LIMIT_RATE));
  const lowerLimit = roundPrice(prevClose * (1 - PRICE_LIMIT_RATE));
  const remaining = totalTicks - 1 - fromTick;
  if (remaining <= 0) return [];

  const windowTicks =
    biasTicks === null ? remaining : Math.min(Math.max(biasTicks, 1), remaining);
  const scale = TICKS_PER_DAY / totalTicks;
  const baseSigma = TICK_SIGMA[tier] * Math.sqrt(scale);
  const jumpProbability = JUMP_PROBABILITY[tier] * scale;
  // 틱당 드리프트: 등급 기본(항상) + 창 안은 bias, 창 밖은 resumeBias
  const baseDriftPerTick = Math.log(1 + DAILY_DRIFT[tier] / 100) / totalTicks;
  const windowDriftPerTick = Math.log(1 + bias / 100) / windowTicks;
  const resumeDriftPerTick = Math.log(1 + resumeBias / 100) / totalTicks;
  // generateDailyPath와 동일한 intraday·클러스터링·레짐 σ 구조 (개장 갭 제외 — 재생성 전용이라 없음)
  // 한계: 레짐을 새로 추첨하고 h를 1로 리셋하므로, 조정 시점에 σ 레벨의 이음새가 생길 수 있다
  // (가격 레벨은 currentPrice에서 연속). 오전 레짐/h 승계는 시그니처 변경이 필요해 하지 않는다.
  // 시세조정은 드문 어드민 수동 개입이라 허용 가능한 트레이드오프.
  const intraday = intradayProfile(totalTicks);
  const regime = pickRegime(tier, rng); // RNG 1 소비 (틱 루프 진입 전)
  let h = 1; // 클러스터링 상태 (틱 간 지속)

  const ticks: Tick[] = [];
  const prices: number[] = [];
  let price = currentPrice;
  for (let i = fromTick + 1; i < totalTicks; i++) {
    const prev = prices.length === 0 ? currentPrice : prices[prices.length - 1];
    const inWindow = i - fromTick <= windowTicks;
    const drift = baseDriftPerTick + (inWindow ? windowDriftPerTick : resumeDriftPerTick);
    const sigma = baseSigma * intraday[i] * h * regime.mult;
    price *= Math.exp(drift + sigma * nextGaussian(rng));
    // 다음 틱 σ에 반영될 상태 진화 (중심화된 |가우시안| 충격 → 방향중립)
    h = clusterStep(h, Math.abs(nextGaussian(rng)) - MEAN_ABS_GAUSSIAN);
    if (rng() < jumpProbability) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < JUMP_UP_PROBABILITY[tier] ? 1 + size : 1 - size;
      h = clusterBoost(h); // 여진: 다음 틱들 σ 상승
    }
    price = Math.min(Math.max(price, lowerLimit), upperLimit);
    const rounded = roundPrice(price);
    prices.push(rounded);
    ticks.push({
      tickIndex: i,
      price: rounded,
      isHalted: false,
      // 가격 확정 후 RNG 소비(volumeScale과 무관하게 항상 1회 → 가격·재현성 불변)
      volume: Math.max(1, Math.round(tickVolume(tier, prev, rounded, rng) * volumeScale)),
    });
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

// --- 헤드페이크(펌프-덤프 함정) 경로 (Phase 3b, 2026-07-20 밸런스 결정 B) ---
// 종목 초반 톤뉴스 채널의 "함정": 개장가에서 완만히 펌프(+6~14%)해 확인 시점(≈30% 지점)에
// 정점을 찍고, 종가까지 덤프(−6~0%)한다. 순진하게 "초반 오르는 것 + 호재 톤"만 보고 사면
// 종가에 물린다. 단서 = 거래량 — 펌프가 완만해(틱당 변동 미미) 거래량이 얇게 유지되므로,
// σ·점프로 거래량이 실리는 "진짜 급등"과 대조된다. bias-0 종목에만 적용해 실제 이벤트와
// 겹치지 않게 하고, 톤뉴스는 tone-up으로 붙는다(generate.ts). 방향은 살 수만 있는(공매도 없는)
// 게임이라 브라켓 차익거래가 열리지 않는다(펌프 높이·시점 rng 변동 → 예측 불가).
// 하네스 검증(2026-07-20): 헤드페이크 0.3이 스위트스팟(실력 상위4 40%·단타 23%, 순진추종 박살).
const HEADFAKE_PUMP_MIN = 0.06; // 펌프 정점 상승률 하한
const HEADFAKE_PUMP_MAX = 0.14; // 펌프 정점 상승률 상한
const HEADFAKE_CLOSE_MIN = -0.06; // 종가 순수익 하한 (−6%)
const HEADFAKE_CLOSE_MAX = 0.0; // 종가 순수익 상한 (0%)
const HEADFAKE_PEAK_FRACTION = 0.3; // 정점 위치 = 톤뉴스 교차검증 창(0~40%) 안, 확인 시점에 맞춤
const HEADFAKE_NOISE = 0.005; // 틱당 ±0.5% 잔떨림
// 거래량 단서 세기 (Phase 3b, 하네스 VOL_TELL_ACC=0.8 재현):
export const HEADFAKE_VOLUME_SCALE = 0.4; // 얇은 헤드페이크(80%) = baseline 40%, 스파이크 없음 = 단서 성립
export const HEADFAKE_LOUD_VOLUME_SCALE = 1.0; // 시끄러운 헤드페이크(20%) = 정상 거래량 → 거래량만 보는 판단도 속임
export const QUIET_REAL_VOLUME_SCALE = 0.4; // 조용한 진짜(20%) = 얇게 → 거래량 확인이 진짜를 놓침(단서 불완전)

// 헤드페이크 경로 생성. RNG 소비: pump 1 + closeRet 1 + 틱당 (가격 noise 1 + 거래량 noise 1).
// 완만한 곡선이라 틱 간 ±8% 급변이 없어 VI는 발동하지 않는다(isHalted 전부 false). 상하한 클램프.
// volumeScale: 거래량 배율. 기본=얇음(0.4). loud 헤드페이크는 HEADFAKE_LOUD_VOLUME_SCALE(1.0)로
// 호출해 정상 거래량처럼 위장한다. 가격은 volumeScale과 무관(경로·RNG 소비 불변).
export function generateHeadfakePath(
  prevClose: number,
  tier: StockTier,
  rng: Rng,
  totalTicks: number = TICKS_PER_DAY,
  volumeScale: number = HEADFAKE_VOLUME_SCALE
): DailyPath {
  const upperLimit = roundPrice(prevClose * (1 + PRICE_LIMIT_RATE));
  const lowerLimit = roundPrice(prevClose * (1 - PRICE_LIMIT_RATE));
  const open = prevClose;
  const pump = HEADFAKE_PUMP_MIN + rng() * (HEADFAKE_PUMP_MAX - HEADFAKE_PUMP_MIN);
  const closeRet = HEADFAKE_CLOSE_MIN + rng() * (HEADFAKE_CLOSE_MAX - HEADFAKE_CLOSE_MIN);
  const peakAt = Math.floor(totalTicks * HEADFAKE_PEAK_FRACTION);
  const ticks: Tick[] = [];
  for (let i = 0; i < totalTicks; i++) {
    // 정점(peakAt)까지 선형 상승 → 이후 종가까지 선형 하강 + 소음
    const frac =
      i <= peakAt
        ? (i / Math.max(1, peakAt)) * pump
        : pump + ((i - peakAt) / Math.max(1, totalTicks - 1 - peakAt)) * (closeRet - pump);
    const noise = (rng() - 0.5) * 2 * HEADFAKE_NOISE;
    const price = roundPrice(
      Math.min(Math.max(open * (1 + frac + noise), lowerLimit), upperLimit)
    );
    // 얇은 거래량: baseline × scale × noise. 변동폭 스파이크(VOLUME_MOVE_K)를 태우지 않아
    // 완만히 오르는데도 거래량이 조용하다 = 진짜 급등과 구별되는 단서.
    const volNoise = VOLUME_NOISE_MIN + rng() * (VOLUME_NOISE_MAX - VOLUME_NOISE_MIN);
    const volume = Math.max(
      1,
      Math.round(VOLUME_BASELINE[tier] * volumeScale * volNoise)
    );
    ticks.push({ tickIndex: i, price, isHalted: false, volume });
  }
  const prices = ticks.map((t) => t.price);
  return {
    ticks,
    open: prices[0],
    high: Math.max(...prices),
    low: Math.min(...prices),
    close: prices[totalTicks - 1],
  };
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

// 등급별 레짐 확률 [calm, normal, stormy]. 잡주일수록 험한 날 비중↑.
export const REGIME_PROB: Record<StockTier, [number, number, number]> = {
  stable: [0.5, 0.45, 0.05],
  normal: [0.4, 0.5, 0.1],
  wild: [0.25, 0.5, 0.25],
};

// 하루 레짐 추첨 (RNG 1 소비). σ 전역 배율만 결정 — 방향 무관.
export function pickRegime(
  tier: StockTier,
  rng: Rng
): { name: "calm" | "normal" | "stormy"; mult: number } {
  const [pCalm, pNormal] = REGIME_PROB[tier];
  const u = rng();
  if (u < pCalm) return { name: "calm", mult: REGIME_MULT.calm };
  if (u < pCalm + pNormal) return { name: "normal", mult: REGIME_MULT.normal };
  return { name: "stormy", mult: REGIME_MULT.stormy };
}

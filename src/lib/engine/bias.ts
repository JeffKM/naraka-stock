// 일일 편향(bias) 추첨 (T-202, PRD §10)
//
// - 매일 종목 수의 약 15%(±1)에 이벤트 배정 — 로스터 규모에 비례 스케일
//   (27종 기준 3~5개). 배정 가중치는 등급별(우량 1.2 / 일반 1 / 잡주 2)
// - 크기: ±10 (40%) / ±20 (35%) / ±30 (25%)
// - 방향(등급별): 상승 확률 우량 60% / 일반 55% / 잡주 50% (우량 우상향)

import type { StockTier } from "@/types/domain";
import type { Rng } from "./rng";

export interface BiasTarget {
  code: string;
  tier: StockTier;
  sector: string;
}

export type BiasMap = Record<string, number>; // code → bias %p (-30~+30, 0=중립)

const MAGNITUDE_TABLE: Array<{ value: number; weight: number }> = [
  { value: 10, weight: 40 },
  { value: 20, weight: 35 },
  { value: 30, weight: 25 },
];

// 등급별 상승 확률 — 우량주를 일반·잡주보다 높여 "오를 확률" 편향(우상향)
const UP_PROBABILITY: Record<StockTier, number> = {
  stable: 0.6,
  normal: 0.55,
  wild: 0.5,
};

// 등급별 이벤트 배정 가중치 (잡주가 이벤트 단골, 우량은 약간 상향)
const EVENT_WEIGHT: Record<StockTier, number> = {
  stable: 1.2,
  normal: 1,
  wild: 2,
};

// 이벤트 종목 수: 로스터 규모에 비례 (종목 수 × 15%), ±1 균등 흔들림
const EVENT_RATIO = 0.15;

function pickWeighted<T>(rng: Rng, table: Array<{ value: T; weight: number }>): T {
  const total = table.reduce((sum, row) => sum + row.weight, 0);
  let roll = rng() * total;
  for (const row of table) {
    roll -= row.weight;
    if (roll < 0) return row.value;
  }
  return table[table.length - 1].value;
}

// 편향의 "실현" (밸런스 장치 — 시뮬레이션으로 튜닝, 2026-07-12)
//
// 추첨된 편향(=뉴스 재료)이 그대로 주가에 반영되면 뉴스추종 전략이 압도한다
// (시뮬레이션에서 중앙값 8.4배). 그래서 재료는 확률적으로만 실현된다:
// - 30% 확률로 방향 반전 (재료 소멸·선반영 컨셉)
// - 실현 강도는 20~100% 균등 (기대 60%)
// 뉴스는 이 실현 경로(realizeBias 후 생성된 실제 움직임)를 "설명"하는 방식으로
// 발행된다(2026-07-14 개편, generate.ts). 즉 원래 bias가 아니라 실현 결과 기준이다.
const FLIP_PROBABILITY = 0.3;
const REALIZATION_MIN = 0.2;
const REALIZATION_MAX = 1.0;

export function realizeBias(bias: number, rng: Rng): number {
  if (bias === 0) return 0;
  const direction = rng() < FLIP_PROBABILITY ? -1 : 1;
  const scale = REALIZATION_MIN + rng() * (REALIZATION_MAX - REALIZATION_MIN);
  return bias * direction * scale;
}

export function drawDailyBiases(stocks: BiasTarget[], rng: Rng): BiasMap {
  const biases: BiasMap = Object.fromEntries(stocks.map((s) => [s.code, 0]));

  // 이벤트 종목 수: 종목 수 × 15%를 기준으로 ±1 (최소 1, 최대 종목 수)
  const base = Math.round(stocks.length * EVENT_RATIO);
  const eventCount = Math.max(1, Math.min(stocks.length, base - 1 + Math.floor(rng() * 3)));

  // 등급별 가중 추첨 (중복 없이)
  const tierOf: Record<string, StockTier> = Object.fromEntries(
    stocks.map((s) => [s.code, s.tier])
  );
  const pool = stocks.map((s) => ({ value: s.code, weight: EVENT_WEIGHT[s.tier] }));
  const picked: string[] = [];
  while (picked.length < eventCount && pool.length > 0) {
    const code = pickWeighted(rng, pool);
    picked.push(code);
    pool.splice(pool.findIndex((p) => p.value === code), 1);
  }

  for (const code of picked) {
    const magnitude = pickWeighted(rng, MAGNITUDE_TABLE);
    const direction = rng() < UP_PROBABILITY[tierOf[code]] ? 1 : -1;
    biases[code] = magnitude * direction;
  }

  return biases;
}

// 섹터 이벤트 (피드백 3): 하루 확률적으로 섹터 1개를 골라 그 섹터 전 종목에
// 공통 방향 편향을 개별 편향에 가산한다. 섹터 뉴스는 이 결과를 설명하는 정식뉴스로
// 후반 노출된다(추종 이득 없음 — generate.ts 정책 준수).
const SECTOR_EVENT_PROBABILITY = 0.5; // 하루 섹터 이벤트 발생 확률
const SECTOR_MAGNITUDE = 8; // 섹터 공통 편향 세기(%p) — 개별 이벤트보다 작게(밸런스 튜닝 대상)
const SECTOR_UP_PROBABILITY = 0.55;

export interface SectorEvent {
  sector: string;
  direction: 1 | -1;
  magnitude: number;
}

// 섹터 이벤트 추첨 (RNG 소비: 발생판정 1 + [발생 시 섹터선택 1 + 방향 1]).
// 발생하지 않으면 null. 대상 섹터가 종목에 없으면 무효.
export function drawSectorEvent(stocks: BiasTarget[], rng: Rng): SectorEvent | null {
  if (rng() >= SECTOR_EVENT_PROBABILITY) return null;
  const sectors = Array.from(new Set(stocks.map((s) => s.sector)));
  if (sectors.length === 0) return null;
  const sector = sectors[Math.floor(rng() * sectors.length)];
  const direction = rng() < SECTOR_UP_PROBABILITY ? 1 : -1;
  return { sector, direction, magnitude: SECTOR_MAGNITUDE };
}

// 개별 편향 맵에 섹터 공통 편향을 가산 (클램프 -30~+30)
export function applySectorEvent(
  biases: BiasMap,
  stocks: BiasTarget[],
  event: SectorEvent | null
): BiasMap {
  if (!event) return biases;
  const merged: BiasMap = { ...biases };
  for (const s of stocks) {
    if (s.sector !== event.sector) continue;
    const next = (merged[s.code] ?? 0) + event.direction * event.magnitude;
    merged[s.code] = Math.max(-30, Math.min(30, next));
  }
  return merged;
}

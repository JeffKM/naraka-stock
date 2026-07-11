// 일일 편향(bias) 추첨 (T-202, PRD §10)
//
// - 매일 2~4개 종목에 이벤트 배정, 잡주(wild)는 배정 확률 2배
// - 크기: ±10 (40%) / ±20 (35%) / ±30 (25%)
// - 방향: 상승 55% / 하락 45% (시장 약우상향)

import type { StockTier } from "@/types/domain";
import type { Rng } from "./rng";

export interface BiasTarget {
  code: string;
  tier: StockTier;
}

export type BiasMap = Record<string, number>; // code → bias %p (-30~+30, 0=중립)

const MAGNITUDE_TABLE: Array<{ value: number; weight: number }> = [
  { value: 10, weight: 40 },
  { value: 20, weight: 35 },
  { value: 30, weight: 25 },
];

const UP_PROBABILITY = 0.55;

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
// 뉴스는 원래 bias 기준으로 발행하므로 뉴스 적중률 명세(90%/55%)는 유지된다.
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

  // 이벤트 종목 수: 2~4개 균등 추첨
  const eventCount = 2 + Math.floor(rng() * 3);

  // 잡주 가중 2배 추첨 (중복 없이)
  const pool = stocks.map((s) => ({ value: s.code, weight: s.tier === "wild" ? 2 : 1 }));
  const picked: string[] = [];
  while (picked.length < eventCount && pool.length > 0) {
    const code = pickWeighted(rng, pool);
    picked.push(code);
    pool.splice(pool.findIndex((p) => p.value === code), 1);
  }

  for (const code of picked) {
    const magnitude = pickWeighted(rng, MAGNITUDE_TABLE);
    const direction = rng() < UP_PROBABILITY ? 1 : -1;
    biases[code] = magnitude * direction;
  }

  return biases;
}

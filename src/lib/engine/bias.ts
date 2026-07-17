// 일일 편향(bias) 추첨 (T-202, PRD §10)
//
// - 매일 종목 수의 약 15%(±1)에 이벤트 배정 — 로스터 규모에 비례 스케일
//   (42종 기준 ~6개). 배정 가중치는 등급별(우량 1.2 / 일반 1 / 잡주 2)
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

// 섹터 이벤트 — 참여확률 모델 (섹터 개편 Plan 3, 스펙 §4)
//
// 좋은 섹터 뉴스라도 "다 오르진 않지만 대부분 체감"되게: 하루에 서로 다른 섹터를
// 0~3개 뽑고(분포 추첨), 각 섹터 구성원은 각자 독립적으로 참여 판정(70%)해 참여한
// 종목에만 큰 공통 편향(±15%p)을 개별 편향에 가산한다. 참여 판정 자체가 랜덤성을
// 제공하므로 섹터 층에는 별도 방향 반전(flip)을 걸지 않는다(뉴스추종 방지는
// generate.ts의 사후 후반 노출 타이밍이 담당). 뉴스는 이 결과를 설명하는 정식뉴스로
// 후반 노출된다.
const SECTOR_MAGNITUDE = 15; // 참여 종목에 가산되는 섹터 공통 편향 세기(%p) — 밸런스 튜닝 대상(Plan 5)
const SECTOR_PARTICIPATION_PROB = 0.7; // 섹터 구성원 각자 참여할 확률
const SECTOR_UP_PROBABILITY = 0.55; // 섹터 이벤트의 상승 방향 확률

// 하루 섹터 이벤트 수 분포 (평균 ≈ 1.3) — 18섹터에서 각 섹터가 30일 내 2~3회 노출
const SECTOR_EVENT_COUNT_TABLE: Array<{ value: number; weight: number }> = [
  { value: 0, weight: 25 },
  { value: 1, weight: 35 },
  { value: 2, weight: 25 },
  { value: 3, weight: 15 },
];

export interface SectorEvent {
  sector: string;
  direction: 1 | -1;
  magnitude: number;
}

// 섹터 이벤트 추첨: 서로 다른 섹터 0~3개.
// RNG 소비 순서: 개수 추첨 1회 → 이벤트마다 (섹터 선택 1 + 방향 1). 개수 0이면 1회만 소비.
export function drawSectorEvents(stocks: BiasTarget[], rng: Rng): SectorEvent[] {
  const count = pickWeighted(rng, SECTOR_EVENT_COUNT_TABLE);
  const pool = Array.from(new Set(stocks.map((s) => s.sector)));
  const n = Math.min(count, pool.length);
  const events: SectorEvent[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    const sector = pool.splice(idx, 1)[0];
    const direction: 1 | -1 = rng() < SECTOR_UP_PROBABILITY ? 1 : -1;
    events.push({ sector, direction, magnitude: SECTOR_MAGNITUDE });
  }
  return events;
}

// 개별 편향 맵에 섹터 이벤트를 참여확률로 가산 (클램프 -30~+30).
// RNG 소비: 이벤트별로 소속 종목을 stocks 배열 순서(code 오름차순)로 순회하며 종목당 1회.
// 비참여 종목은 변화 없음. 이벤트/종목 순회 순서가 batch·simulate에서 동일해야 재현성이 유지된다.
export function applySectorEvents(
  biases: BiasMap,
  stocks: BiasTarget[],
  events: SectorEvent[],
  rng: Rng
): BiasMap {
  if (events.length === 0) return { ...biases };
  const merged: BiasMap = { ...biases };
  for (const event of events) {
    for (const s of stocks) {
      if (s.sector !== event.sector) continue;
      if (rng() < SECTOR_PARTICIPATION_PROB) {
        const next = (merged[s.code] ?? 0) + event.direction * event.magnitude;
        merged[s.code] = Math.max(-30, Math.min(30, next));
      }
    }
  }
  return merged;
}

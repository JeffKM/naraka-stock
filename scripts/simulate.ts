// 몬테카를로 밸런스 시뮬레이션 (T-207)
//
// 실행: npm run simulate [-- --runs 1000]
// 운영 배치와 동일한 엔진(src/lib/engine/)으로 이벤트 기간의 개장일(휴장 규칙에서 파생 —
// 정기 휴장 없음이면 08-01~08-30 = 30일)을 1,000회 반복해 전략별 최종 자산 분포를 확인한다
// (PRD §10 목표 검증).

import { drawDailyBiases, realizeBias, type BiasMap } from "../src/lib/engine/bias";
import { generateDailyPath, type DailyPath } from "../src/lib/engine/randomWalk";
import { createRng, hashSeed, type Rng } from "../src/lib/engine/rng";
import { addDays, isOpenDate } from "../src/lib/market";
import type { StockTier } from "../src/types/domain";

// --- 이벤트 설정 (시드 데이터와 동일) ---
const EVENT_START = "2026-08-01";
const EVENT_END = "2026-08-30";
const INITIAL_CASH = 1_000_000;
const SELL_FEE_RATE = 0.003;
const DIVIDEND_RATE = 0.01;

// 등급·기준가는 운영 확정안 기준 (2026-07-14, migrations/20260714000000)
const STOCKS: Array<{ code: string; tier: StockTier; initial: number }> = [
  { code: "MLVD", tier: "stable", initial: 245000 },
  { code: "OKHX", tier: "stable", initial: 198000 },
  { code: "NRKE", tier: "stable", initial: 128000 },
  { code: "MAPL", tier: "stable", initial: 172000 },
  { code: "ALBN", tier: "stable", initial: 152000 },
  { code: "BNZN", tier: "stable", initial: 135000 },
  { code: "OKSL", tier: "stable", initial: 118000 },
  { code: "NOMH", tier: "stable", initial: 105000 },
  { code: "MLMT", tier: "stable", initial: 102000 },
  { code: "MRSF", tier: "normal", initial: 92000 },
  { code: "OKCT", tier: "normal", initial: 84000 },
  { code: "MRCL", tier: "normal", initial: 76000 },
  { code: "BNOC", tier: "normal", initial: 68000 },
  { code: "OKFX", tier: "normal", initial: 62000 },
  { code: "MIPA", tier: "normal", initial: 54000 },
  { code: "BNSK", tier: "normal", initial: 46000 },
  { code: "MRFI", tier: "normal", initial: 39000 },
  { code: "NRKM", tier: "normal", initial: 33000 },
  { code: "MHEN", tier: "wild", initial: 24500 },
  { code: "BBNN", tier: "wild", initial: 19800 },
  { code: "MLTA", tier: "wild", initial: 17500 },
  { code: "SPCO", tier: "wild", initial: 14800 },
  { code: "NRKB", tier: "wild", initial: 11200 },
  { code: "MHBT", tier: "wild", initial: 9400 },
  { code: "MELL", tier: "wild", initial: 7600 },
  { code: "BNAS", tier: "wild", initial: 6200 },
  { code: "OKCC", tier: "wild", initial: 4900 },
];

// 개장일 목록
function openDays(): string[] {
  const days: string[] = [];
  for (let d = EVENT_START; d <= EVENT_END; d = addDays(d, 1)) {
    if (isOpenDate(d)) days.push(d);
  }
  return days;
}

interface DayMarket {
  date: string;
  isFriday: boolean;
  biases: BiasMap;
  paths: Record<string, DailyPath>;
  prevCloses: Record<string, number>;
}

// 한 회차의 시장 전체 시뮬레이션 (배치와 동일한 절차)
function simulateMarket(rng: Rng): DayMarket[] {
  const closes: Record<string, number> = Object.fromEntries(
    STOCKS.map((s) => [s.code, s.initial])
  );
  const result: DayMarket[] = [];

  for (const date of openDays()) {
    const biases = drawDailyBiases(STOCKS, rng);
    const paths: Record<string, DailyPath> = {};
    const prevCloses = { ...closes };
    for (const stock of STOCKS) {
      // 배치와 동일: 뉴스용 bias와 별개로 실현치는 확률적
      const path = generateDailyPath(
        closes[stock.code],
        realizeBias(biases[stock.code], rng),
        stock.tier,
        rng
      );
      paths[stock.code] = path;
      closes[stock.code] = path.close;
    }
    result.push({
      date,
      isFriday: new Date(`${date}T12:00:00Z`).getUTCDay() === 5,
      biases,
      paths,
      prevCloses,
    });
  }
  return result;
}

// --- 뉴스 배치 타이밍 실험 (T-503) ---
// 정식뉴스가 하루 경로의 어느 틱에 노출되느냐 = 뉴스추종이 먹을 수 있는 "남은 드리프트".
//   steepest = 현재 운영: 가장 가파른 3틱 구간 (움직임 한창)
//   middle   = 장 중간
//   tail     = 움직임이 대부분 끝난 뒤 (후반 85% 지점)
//   close    = 종가 직전 (남은 움직임 ≈ 0)
type NewsTiming = "steepest" | "middle" | "tail" | "close";
const NEWS_TIMING: NewsTiming = ((): NewsTiming => {
  const i = process.argv.indexOf("--news-timing");
  const v = i >= 0 ? process.argv[i + 1] : "tail"; // 운영 기본값 = tail (generate.ts와 동일)
  return (["steepest", "middle", "tail", "close"] as const).includes(v as NewsTiming)
    ? (v as NewsTiming)
    : "tail";
})();

const STEEP_WINDOW = 3; // generate.ts와 동일

// generate.ts의 steepestTickIndex와 동일 로직
function steepestTickIndex(ticks: { tickIndex: number; price: number }[]): number {
  if (ticks.length <= STEEP_WINDOW) return ticks.length - 1;
  let bestIdx = STEEP_WINDOW;
  let bestAbs = -1;
  for (let i = STEEP_WINDOW; i < ticks.length; i++) {
    const delta = Math.abs(ticks[i].price - ticks[i - STEEP_WINDOW].price);
    if (delta > bestAbs) {
      bestAbs = delta;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function newsTickIndex(ticks: { tickIndex: number; price: number }[], mode: NewsTiming): number {
  const last = ticks.length - 1;
  switch (mode) {
    case "steepest":
      return steepestTickIndex(ticks);
    case "middle":
      return Math.floor(last * 0.5);
    case "tail":
      // generate.ts tailNewsTick과 동일: steepest 이후 & 후반 85% 이후 중 늦은 쪽
      return Math.max(steepestTickIndex(ticks), Math.floor(last * 0.85));
    case "close":
      return last;
  }
}

// --- 전략들: 하루 단위로 (현금, 보유) 상태를 갱신한다 ---

type Portfolio = { cash: number; qty: Record<string, number> };

function buyAll(p: Portfolio, code: string, price: number) {
  const qty = Math.floor(p.cash / price);
  if (qty > 0) {
    p.cash -= qty * price;
    p.qty[code] = (p.qty[code] ?? 0) + qty;
  }
}

function sellAll(p: Portfolio, code: string, price: number) {
  const qty = p.qty[code] ?? 0;
  if (qty > 0) {
    const gross = qty * price;
    p.cash += gross - Math.floor(gross * SELL_FEE_RATE);
    p.qty[code] = 0;
  }
}

function totalAssets(p: Portfolio, closes: Record<string, number>): number {
  let total = p.cash;
  for (const [code, qty] of Object.entries(p.qty)) {
    total += qty * (closes[code] ?? 0);
  }
  return total;
}

function payDividends(p: Portfolio, day: DayMarket) {
  if (!day.isFriday) return;
  for (const stock of STOCKS) {
    if (stock.tier !== "stable") continue;
    const qty = p.qty[stock.code] ?? 0;
    if (qty > 0) {
      p.cash += Math.floor(qty * day.paths[stock.code].close * DIVIDEND_RATE);
    }
  }
}

interface Strategy {
  name: string;
  run: (market: DayMarket[], rng: Rng) => number; // 최종 총자산
}

const STRATEGIES: Strategy[] = [
  {
    // 존버: 첫날 전 종목 균등 분산 매수 후 방치 (배당 수령)
    name: "존버(분산)",
    run: (market) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      const first = market[0];
      const budget = Math.floor(p.cash / STOCKS.length);
      for (const stock of STOCKS) {
        const price = first.paths[stock.code].open;
        const qty = Math.floor(budget / price);
        p.cash -= qty * price;
        p.qty[stock.code] = qty;
      }
      for (const day of market) payDividends(p, day);
      const lastCloses = Object.fromEntries(
        STOCKS.map((s) => [s.code, market[market.length - 1].paths[s.code].close])
      );
      return totalAssets(p, lastCloses);
    },
  },
  {
    // 안정주 존버: 안정주 전체 균등 매수 (배당 파밍)
    name: "존버(안정주)",
    run: (market) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      const first = market[0];
      const stables = STOCKS.filter((s) => s.tier === "stable");
      const budget = Math.floor(p.cash / stables.length);
      for (const stock of stables) {
        const price = first.paths[stock.code].open;
        const qty = Math.floor(budget / price);
        p.cash -= qty * price;
        p.qty[stock.code] = qty;
      }
      for (const day of market) payDividends(p, day);
      const lastCloses = Object.fromEntries(
        STOCKS.map((s) => [s.code, market[market.length - 1].paths[s.code].close])
      );
      return totalAssets(p, lastCloses);
    },
  },
  {
    // 단타(무작위): 매일 아무 종목이나 시가 몰빵 → 종가 전량 매도
    name: "단타(무작위)",
    run: (market, rng) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      for (const day of market) {
        const stock = STOCKS[Math.floor(rng() * STOCKS.length)];
        buyAll(p, stock.code, day.paths[stock.code].open);
        sellAll(p, stock.code, day.paths[stock.code].close);
        payDividends(p, day);
      }
      return p.cash;
    },
  },
  {
    // 뉴스추종: 커버리지 70%·적중률 90%의 힌트를 받아 가장 강한 상승 힌트에 몰빵.
    // 현실화(2026-07-14): 시가가 아니라 "뉴스가 뜬 틱 가격"에 사서 종가에 판다.
    // 뉴스 배치 위치(NEWS_TIMING)에 따라 남은 드리프트만 먹을 수 있으므로,
    // 뉴스를 뒤로 밀수록 이득이 줄어든다.
    name: "뉴스추종",
    run: (market, rng) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      for (const day of market) {
        let best: { code: string; hint: number } | null = null;
        for (const stock of STOCKS) {
          const bias = day.biases[stock.code];
          if (bias === 0 || rng() >= 0.7) continue; // 뉴스 없음
          const hint = rng() < 0.9 ? bias : -bias; // 10% 오보
          if (hint > 0 && (!best || hint > best.hint)) {
            best = { code: stock.code, hint };
          }
        }
        if (best) {
          const ticks = day.paths[best.code].ticks;
          const entryIdx = newsTickIndex(ticks, NEWS_TIMING);
          buyAll(p, best.code, ticks[entryIdx].price); // 뉴스 뜬 틱에 진입
          sellAll(p, best.code, day.paths[best.code].close);
        }
        payDividends(p, day);
      }
      return p.cash;
    },
  },
  {
    // 잡주 몰빵: 매일 잡주 중 하나에 시가 몰빵 → 종가 매도 (하이리스크 상한 확인용)
    name: "잡주몰빵",
    run: (market, rng) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      const wilds = STOCKS.filter((s) => s.tier === "wild");
      for (const day of market) {
        const stock = wilds[Math.floor(rng() * wilds.length)];
        buyAll(p, stock.code, day.paths[stock.code].open);
        sellAll(p, stock.code, day.paths[stock.code].close);
        payDividends(p, day);
      }
      return p.cash;
    },
  },
];

// --- 실행 ---

function percentile(sorted: number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

function main() {
  const runsArg = process.argv.indexOf("--runs");
  const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 1000;

  console.log(
    `개장일 ${openDays().length}일 × ${runs}회 몬테카를로 시뮬레이션 (뉴스 타이밍=${NEWS_TIMING})\n`
  );

  const results: Record<string, number[]> = Object.fromEntries(
    STRATEGIES.map((s) => [s.name, []])
  );

  for (let run = 0; run < runs; run++) {
    const marketRng = createRng(hashSeed(`market|${run}`));
    const market = simulateMarket(marketRng);
    for (const strategy of STRATEGIES) {
      const rng = createRng(hashSeed(`${strategy.name}|${run}`));
      results[strategy.name].push(strategy.run(market, rng));
    }
  }

  const fmt = (n: number) => `${Math.round(n / 10000) / 100}배`;
  console.log(
    "전략별 최종 총자산 (초기 자금 대비 배수) — 중앙값 / 평균 / 상위10% / 최대 / 원금손실율"
  );
  for (const strategy of STRATEGIES) {
    const sorted = [...results[strategy.name]].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const lossRate = sorted.filter((v) => v < INITIAL_CASH).length / sorted.length;
    console.log(
      `${strategy.name.padEnd(10)} ${fmt(percentile(sorted, 0.5))} / ${fmt(mean)} / ${fmt(
        percentile(sorted, 0.9)
      )} / ${fmt(sorted[sorted.length - 1])} / ${(lossRate * 100).toFixed(1)}%`
    );
  }
}

main();

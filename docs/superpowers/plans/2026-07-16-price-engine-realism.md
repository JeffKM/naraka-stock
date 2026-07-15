# 가격 엔진 리얼리티 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `randomWalk.ts`의 등급별 상수 σ를 시간·상태에 따라 살아 있는 σ(인트라데이 U-shape · 변동성 클러스터링 · 점프 여진 · 레짐 · 개장 갭)로 바꿔 차트를 실제 시장처럼 숨 쉬게 만든다.

**Architecture:** 사전생성 경로 아키텍처를 그대로 유지한다. 틱당 σ를 `TICK_SIGMA[tier] · sqrt(scale) · intraday · cluster · regime`의 곱으로 재정의하고, 방향(드리프트)은 절대 건드리지 않는다(방향중립 → 지정가 브라켓 차익 자멸 유지). 새 동작은 전부 `randomWalk.ts` 내부이며 `generateDailyPath`/`regenerateRemainingPath`의 **시그니처는 불변** → 배치·서비스·시뮬레이터 무변경.

**Tech Stack:** TypeScript 5 (strict), `tsx` 스탠드얼론 검증 스크립트(유닛 테스트 러너 없음), 기존 시드 RNG(`src/lib/engine/rng.ts`, mulberry32 + Box-Muller), `npm run simulate` 몬테카를로 밸런스 게이트.

## Global Constraints

- **방향중립(위반 금지):** `bias`·`DAILY_DRIFT[tier]`(드리프트)는 절대 변경 금지. 바꾸는 건 σ 크기·시간구조와 개장 갭뿐. 관측 가능한 방향 예측을 만들면 안 된다.
- **결정적 재현:** 모든 난수는 기존 `rng.ts`의 `rng()` / `nextGaussian(rng)`에서만 소비. `Math.random()` 금지.
- **하루 기대 총변동성 보존:** `intraday`·`cluster`의 평균 배율 ≈ 1로 정규화. 레짐만 의도적으로 이동.
- **상하한·VI 불변:** `PRICE_LIMIT_RATE = 0.3`, `VI_THRESHOLD = 0.08`, `VI_HALT_TICKS = 1`, 클램프·VI 마킹 로직 그대로.
- **시그니처 불변:** `generateDailyPath(prevClose, bias, tier, rng, totalTicks?)`, `regenerateRemainingPath(...)`, `Tick`/`DailyPath` 인터페이스 유지.
- **틱수 보정 유지:** `scale = TICKS_PER_DAY / totalTicks`, `TICKS_PER_DAY = 84`.
- **기존 상수 유지:** `TICK_SIGMA = {stable:0.005, normal:0.009, wild:0.015}`, `DAILY_DRIFT = {stable:0.2, normal:0, wild:-0.2}`, `JUMP_PROBABILITY = {stable:0.004, normal:0.006, wild:0.015}`, `JUMP_MIN=0.02`, `JUMP_MAX=0.07`.
- **코딩 컨벤션:** strict(any 금지), 2칸 들여쓰기, 세미콜론, 더블 쿼트, 개별 임포트, 주석·커밋 한국어.

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `src/lib/engine/randomWalk.ts` | 일일 가격 경로 생성 + σ 프로파일 헬퍼 | 수정 (핵심) |
| `scripts/verify-realism.ts` | 순수 헬퍼·통계 속성 어서션 (tsx 실행) | 신규 |
| `scripts/simulate.ts` | 몬테카를로 밸런스 게이트 | 무변경(그대로 재사용) |

---

### Task 1: 인트라데이 U-shape σ 프로파일

개장·마감에 σ↑, 정오에 σ↓인 결정적 시간 배율. 구간 평균을 정확히 1로 정규화해 하루 총변동성을 보존한다. RNG 미소비.

**Files:**
- Create: `scripts/verify-realism.ts`
- Modify: `src/lib/engine/randomWalk.ts`

**Interfaces:**
- Produces: `intradayProfile(totalTicks: number): number[]` — export. 길이 `totalTicks`, 평균 정확히 1, 양끝 > 중앙, 좌우 대칭.

- [ ] **Step 1: 검증 하네스 + 첫 어서션 작성 (`scripts/verify-realism.ts` 신규)**

```ts
// 가격 엔진 리얼리티 개선 검증 (유닛 러너 부재 → tsx 스탠드얼론)
// 실행: npx tsx scripts/verify-realism.ts
import { intradayProfile } from "../src/lib/engine/randomWalk";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ok  ${name}${detail ? "  " + detail : ""}`);
  } else {
    console.error(`FAIL  ${name}${detail ? "  " + detail : ""}`);
    failures++;
  }
}
function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

// --- Task 1: 인트라데이 U-shape ---
{
  const prof = intradayProfile(84);
  const mean = prof.reduce((a, b) => a + b, 0) / prof.length;
  const mid = prof[Math.floor(prof.length / 2)];
  check("intraday: 길이 == totalTicks", prof.length === 84);
  check("intraday: 평균 == 1", approx(mean, 1, 1e-9), `mean=${mean}`);
  check("intraday: 개장 > 정오", prof[0] > mid, `open=${prof[0].toFixed(3)} mid=${mid.toFixed(3)}`);
  check("intraday: 마감 > 정오", prof[prof.length - 1] > mid);
  check("intraday: 좌우 대칭", approx(prof[0], prof[prof.length - 1], 1e-9));
  check("intraday: totalTicks=1 안전", intradayProfile(1).length === 1);
}

if (failures > 0) {
  console.error(`\n${failures}개 검증 실패`);
  process.exit(1);
}
console.log("\n모든 검증 통과");
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: FAIL — `intradayProfile`가 export되지 않아 import 에러 / undefined.

- [ ] **Step 3: `randomWalk.ts`에 상수·헬퍼 추가**

`import` 아래, `TICK_SIGMA` 근처에 상수 추가:

```ts
// --- 리얼리티 개선 상수 (2026-07-16, 경로 생성 층위) ---
// σ = TICK_SIGMA·sqrt(scale)·intraday·cluster·regime. 전부 방향중립(σ만 스케일).
const INTRADAY_U_AMPLITUDE = 0.8; // U자 진폭 (개장·마감 대비 정오)
```

파일 하단(다른 export 함수와 같은 레벨)에 헬퍼 추가:

```ts
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
```

- [ ] **Step 4: `generateDailyPath` 루프에 intraday 적용**

`const sigma = TICK_SIGMA[tier] * Math.sqrt(scale);` 를 baseSigma로 바꾸고 루프에서 틱별 σ를 만든다.

기존:
```ts
  const scale = TICKS_PER_DAY / totalTicks;
  const sigma = TICK_SIGMA[tier] * Math.sqrt(scale);
  const jumpProbability = JUMP_PROBABILITY[tier] * scale;

  const prices: number[] = [];
  let price = prevClose;
  for (let i = 0; i < totalTicks; i++) {
    price *= Math.exp(driftPerTick + sigma * nextGaussian(rng));
```

변경:
```ts
  const scale = TICKS_PER_DAY / totalTicks;
  const baseSigma = TICK_SIGMA[tier] * Math.sqrt(scale);
  const jumpProbability = JUMP_PROBABILITY[tier] * scale;
  const intraday = intradayProfile(totalTicks);

  const prices: number[] = [];
  let price = prevClose;
  for (let i = 0; i < totalTicks; i++) {
    const sigma = baseSigma * intraday[i];
    price *= Math.exp(driftPerTick + sigma * nextGaussian(rng));
```

(루프 이후 점프·클램프·VI 로직은 그대로 둔다.)

- [ ] **Step 5: 실행해서 통과 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: PASS — Task 1 어서션 전부 `ok`, "모든 검증 통과".

- [ ] **Step 6: 커밋**

```bash
git add scripts/verify-realism.ts src/lib/engine/randomWalk.ts
git commit -m "feat: 가격 엔진 인트라데이 U-shape 변동성 도입"
```

---

### Task 2: 변동성 클러스터링 (GARCH-lite)

지속성 상태변수 `h`를 AR(1)로 진화시켜 "험한 구간이 뭉쳐서" 오게 한다. 충격은 방향중립(중심화된 |가우시안|). σ만 스케일한다.

**Files:**
- Modify: `src/lib/engine/randomWalk.ts`
- Modify: `scripts/verify-realism.ts`

**Interfaces:**
- Consumes: `intradayProfile` (Task 1).
- Produces: `clusterStep(h: number, shock: number): number` — export. AR(1) `1 + ρ(h−1) + η·shock`을 `[CLUSTER_MIN, CLUSTER_MAX]`로 클램프. 상수 `CLUSTER_RHO=0.9`, `CLUSTER_ETA=0.15`, `CLUSTER_MIN=0.5`, `CLUSTER_MAX=2.5`.

- [ ] **Step 1: 검증 어서션 추가 (`scripts/verify-realism.ts`)**

import 줄에 추가:
```ts
import {
  intradayProfile,
  clusterStep,
  generateDailyPath,
} from "../src/lib/engine/randomWalk";
import { createRng, hashSeed } from "../src/lib/engine/rng";
import type { StockTier } from "../src/types/domain";
```

Task 1 블록 아래에 추가:
```ts
// --- Task 2: 변동성 클러스터링 ---
{
  check("cluster: 중립 상태 유지", clusterStep(1, 0) === 1);
  check("cluster: ρ 감쇠", approx(clusterStep(2, 0), 1.9, 1e-12), `=${clusterStep(2, 0)}`);
  check("cluster: 상한 클램프", clusterStep(2.5, 100) === 2.5);
  check("cluster: 하한 클램프", clusterStep(1, -100) === 0.5);

  // 통계: 제곱 로그수익률의 lag-1 자기상관 > 0 (클러스터링 지표)
  function lag1Autocorr(xs: number[]): number {
    const n = xs.length;
    const m = xs.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) den += (xs[i] - m) ** 2;
    for (let i = 1; i < n; i++) num += (xs[i] - m) * (xs[i - 1] - m);
    return den === 0 ? 0 : num / den;
  }
  let sum = 0;
  const K = 400;
  for (let k = 0; k < K; k++) {
    const r = createRng(hashSeed(`cluster|${k}`));
    const p = generateDailyPath(10000, 0, "wild", r, 84);
    const sq: number[] = [];
    for (let i = 1; i < p.ticks.length; i++) {
      sq.push(Math.log(p.ticks[i].price / p.ticks[i - 1].price) ** 2);
    }
    sum += lag1Autocorr(sq);
  }
  const avg = sum / K;
  check("cluster: 제곱수익률 lag-1 자기상관 > 0.02", avg > 0.02, `avg=${avg.toFixed(4)}`);
}
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: FAIL — `clusterStep` 미export.

- [ ] **Step 3: `randomWalk.ts`에 상수·헬퍼 추가**

Task 1 상수 아래에 추가:
```ts
const CLUSTER_RHO = 0.9; // 클러스터링 지속성 (AR(1))
const CLUSTER_ETA = 0.15; // 충격 감도
const CLUSTER_MIN = 0.5;
const CLUSTER_MAX = 2.5;
const MEAN_ABS_GAUSSIAN = Math.sqrt(2 / Math.PI); // E[|Z|] — 충격 중심화용
```

헬퍼 추가(`intradayProfile` 아래):
```ts
// 변동성 클러스터링 상태 갱신 (AR(1) + 클램프). shock은 중심화된 |가우시안|이라
// 평균 0 → E[h]≈1(총변동성 보존). σ 배율만 → 방향중립.
export function clusterStep(h: number, shock: number): number {
  const next = 1 + CLUSTER_RHO * (h - 1) + CLUSTER_ETA * shock;
  return Math.min(CLUSTER_MAX, Math.max(CLUSTER_MIN, next));
}
```

- [ ] **Step 4: `generateDailyPath` 루프에 클러스터링 상태 통합**

Task 1에서 바꾼 루프를 다음으로 확장:
```ts
  const intraday = intradayProfile(totalTicks);
  let h = 1; // 클러스터링 상태 (틱 간 지속)

  const prices: number[] = [];
  let price = prevClose;
  for (let i = 0; i < totalTicks; i++) {
    const sigma = baseSigma * intraday[i] * h;
    price *= Math.exp(driftPerTick + sigma * nextGaussian(rng));
    // 다음 틱 σ에 반영될 상태 진화 (중심화된 |가우시안| 충격 → 방향중립)
    h = clusterStep(h, Math.abs(nextGaussian(rng)) - MEAN_ABS_GAUSSIAN);
    if (rng() < jumpProbability) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < 0.5 ? 1 + size : 1 - size;
    }
    price = Math.min(Math.max(price, lowerLimit), upperLimit);
    prices.push(roundPrice(price));
  }
```

- [ ] **Step 5: 실행해서 통과 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: PASS — cluster 어서션 전부 `ok`(자기상관 avg는 대략 0.05~0.2 범위).

- [ ] **Step 6: 커밋**

```bash
git add scripts/verify-realism.ts src/lib/engine/randomWalk.ts
git commit -m "feat: 가격 엔진 변동성 클러스터링(GARCH-lite) 도입"
```

---

### Task 3: 점프 여진 (aftershock)

점프 발생 시 클러스터링 상태 `h`를 일시 부스트해 큰 사건 뒤 흔들림이 AR(1)로 감쇠하며 이어지게 한다.

**Files:**
- Modify: `src/lib/engine/randomWalk.ts`
- Modify: `scripts/verify-realism.ts`

**Interfaces:**
- Consumes: `clusterStep`, `CLUSTER_MAX` (Task 2).
- Produces: `clusterBoost(h: number): number` — export. `min(CLUSTER_MAX, h + AFTERSHOCK_BOOST)`. 상수 `AFTERSHOCK_BOOST=0.8`.

- [ ] **Step 1: 검증 어서션 추가 (`scripts/verify-realism.ts`)**

import에 `clusterBoost` 추가. Task 2 블록 아래:
```ts
// --- Task 3: 점프 여진 ---
{
  check("aftershock: 부스트 적용", approx(clusterBoost(1), 1.8, 1e-12), `=${clusterBoost(1)}`);
  check("aftershock: 상한 클램프", clusterBoost(2.4) === 2.5);
}
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: FAIL — `clusterBoost` 미export.

- [ ] **Step 3: `randomWalk.ts`에 상수·헬퍼 추가**

상수 블록에:
```ts
const AFTERSHOCK_BOOST = 0.8; // 점프 후 클러스터링 상태 부스트 (여진)
```

헬퍼(`clusterStep` 아래):
```ts
// 점프 여진: 점프 직후 클러스터링 상태를 일시 부스트(이후 AR(1)로 감쇠).
export function clusterBoost(h: number): number {
  return Math.min(CLUSTER_MAX, h + AFTERSHOCK_BOOST);
}
```

- [ ] **Step 4: `generateDailyPath` 점프 블록에 여진 통합**

Task 2 루프의 점프 분기를 확장:
```ts
    if (rng() < jumpProbability) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < 0.5 ? 1 + size : 1 - size;
      h = clusterBoost(h); // 여진: 다음 틱들 σ 상승
    }
```

- [ ] **Step 5: 실행해서 통과 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: PASS — aftershock 어서션 `ok`. cluster 자기상관도 여전히 통과.

- [ ] **Step 6: 커밋**

```bash
git add scripts/verify-realism.ts src/lib/engine/randomWalk.ts
git commit -m "feat: 가격 엔진 점프 여진(aftershock) 도입"
```

---

### Task 4: 레짐 (조용한 날 / 험한 날)

하루 시작 시 등급별 확률로 저주파 레짐을 추첨해 전역 σ 배율을 준다. σ만 바꾼다(방향성 레짐 제외).

**Files:**
- Modify: `src/lib/engine/randomWalk.ts`
- Modify: `scripts/verify-realism.ts`

**Interfaces:**
- Produces:
  - `REGIME_PROB: Record<StockTier, [number, number, number]>` — export. `[calm, normal, stormy]` 확률, 각 행 합 1.
  - `pickRegime(tier: StockTier, rng: Rng): { name: "calm" | "normal" | "stormy"; mult: number }` — export. RNG 1 소비. mult ∈ {0.7, 1.0, 1.6}.

- [ ] **Step 1: 검증 어서션 추가 (`scripts/verify-realism.ts`)**

import에 `pickRegime`, `REGIME_PROB` 추가. Task 3 블록 아래:
```ts
// --- Task 4: 레짐 ---
{
  const tiers: StockTier[] = ["stable", "normal", "wild"];
  for (const tier of tiers) {
    const [pc, pn, ps] = REGIME_PROB[tier];
    check(`regime ${tier}: 확률 합 == 1`, approx(pc + pn + ps, 1, 1e-12));
    const r = createRng(hashSeed(`regime|${tier}`));
    const counts = { calm: 0, normal: 0, stormy: 0 };
    const N = 200000;
    for (let i = 0; i < N; i++) counts[pickRegime(tier, r).name]++;
    check(`regime ${tier}: calm 빈도 ≈ ${pc}`, approx(counts.calm / N, pc, 0.01), `${(counts.calm / N).toFixed(3)}`);
    check(`regime ${tier}: stormy 빈도 ≈ ${ps}`, approx(counts.stormy / N, ps, 0.01), `${(counts.stormy / N).toFixed(3)}`);
  }
  const mults = new Set([pickRegime("wild", createRng(1)).mult]);
  check("regime: mult 값 검증", [0.7, 1.0, 1.6].includes([...mults][0]));
}
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: FAIL — `pickRegime`/`REGIME_PROB` 미export.

- [ ] **Step 3: `randomWalk.ts`에 상수·헬퍼 추가**

`import { nextGaussian, type Rng } from "./rng";` 는 이미 있다. 상수 블록에:
```ts
// 레짐: σ 배율만(방향중립). 하루 시작 시 등급별 추첨.
const REGIME_MULT = { calm: 0.7, normal: 1.0, stormy: 1.6 } as const;
```

파일에 export 상수·헬퍼 추가(`clusterBoost` 아래):
```ts
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
```

- [ ] **Step 4: `generateDailyPath`에 레짐 통합**

루프 앞(`let h = 1;` 근처)에서 레짐을 뽑고 σ에 곱한다. **RNG 소비 순서 주의:** 레짐 추첨은 첫 틱 가우시안보다 먼저 온다.
```ts
  const intraday = intradayProfile(totalTicks);
  const regime = pickRegime(tier, rng); // RNG 1 소비 (틱 루프 진입 전)
  let h = 1;

  const prices: number[] = [];
  let price = prevClose;
  for (let i = 0; i < totalTicks; i++) {
    const sigma = baseSigma * intraday[i] * h * regime.mult;
    price *= Math.exp(driftPerTick + sigma * nextGaussian(rng));
```

- [ ] **Step 5: 실행해서 통과 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: PASS — regime 어서션 `ok`(빈도가 확률 ±0.01 내).

- [ ] **Step 6: 커밋**

```bash
git add scripts/verify-realism.ts src/lib/engine/randomWalk.ts
git commit -m "feat: 가격 엔진 레짐(조용/험한 날) 도입"
```

---

### Task 5: 개장 갭

tick 0 진입 전 방향 랜덤 갭을 준다(드리프트 없음 → 오버나이트 지정가 arb 안전). 상하한 클램프 안.

**Files:**
- Modify: `src/lib/engine/randomWalk.ts`
- Modify: `scripts/verify-realism.ts`

**Interfaces:**
- Produces:
  - `GAP_SIGMA: Record<StockTier, number>` — export. `{stable:0.003, normal:0.005, wild:0.008}`.
  - `openingGapFactor(tier: StockTier, rng: Rng): number` — export. `exp(GAP_SIGMA[tier]·Z)`, RNG(가우시안) 소비. E[log]=0.

- [ ] **Step 1: 검증 어서션 추가 (`scripts/verify-realism.ts`)**

import에 `openingGapFactor`, `GAP_SIGMA` 추가. Task 4 블록 아래:
```ts
// --- Task 5: 개장 갭 ---
{
  const r = createRng(hashSeed("gap"));
  const logs: number[] = [];
  const N = 200000;
  for (let i = 0; i < N; i++) logs.push(Math.log(openingGapFactor("wild", r)));
  const mean = logs.reduce((a, b) => a + b, 0) / N;
  const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / N);
  check("gap: 평균 log ≈ 0 (방향중립)", approx(mean, 0, 0.001), `mean=${mean.toFixed(4)}`);
  check("gap: 표준편차 ≈ GAP_SIGMA.wild", approx(sd, GAP_SIGMA.wild, GAP_SIGMA.wild * 0.05), `sd=${sd.toFixed(4)}`);
  check("gap: 등급 순서 stable<normal<wild", GAP_SIGMA.stable < GAP_SIGMA.normal && GAP_SIGMA.normal < GAP_SIGMA.wild);
}
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: FAIL — `openingGapFactor`/`GAP_SIGMA` 미export.

- [ ] **Step 3: `randomWalk.ts`에 상수·헬퍼 추가**

```ts
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
```

- [ ] **Step 4: `generateDailyPath` 시작가에 갭 적용**

**RNG 소비 순서 주의:** 갭은 레짐 추첨 다음, 첫 틱 가우시안보다 먼저. `let price = prevClose;` 를 교체:
```ts
  const regime = pickRegime(tier, rng);
  let h = 1;

  const prices: number[] = [];
  // 개장 갭 (틱 진입 전 1회, 상하한 클램프)
  let price = Math.min(
    Math.max(prevClose * openingGapFactor(tier, rng), lowerLimit),
    upperLimit
  );
  for (let i = 0; i < totalTicks; i++) {
```

- [ ] **Step 5: 실행해서 통과 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: PASS — gap 어서션 `ok`.

- [ ] **Step 6: 커밋**

```bash
git add scripts/verify-realism.ts src/lib/engine/randomWalk.ts
git commit -m "feat: 가격 엔진 개장 갭 도입"
```

---

### Task 6: `regenerateRemainingPath` σ 구조 동기화

장중 시세조정(어드민)도 동일한 intraday·클러스터링·레짐 σ 구조를 쓰게 해 시각적 이음새를 없앤다. 갭은 개장 전용이라 제외.

**Files:**
- Modify: `src/lib/engine/randomWalk.ts`
- Modify: `scripts/verify-realism.ts`

**Interfaces:**
- Consumes: `intradayProfile`, `clusterStep`, `clusterBoost`, `pickRegime` (Task 1–4).
- Produces: `regenerateRemainingPath` 동작 갱신(시그니처 불변). 반환 틱은 `fromTick+1..totalTicks-1` 연속, 전부 `[lowerLimit, upperLimit]` 안.

- [ ] **Step 1: 검증 어서션 추가 (`scripts/verify-realism.ts`)**

import에 `regenerateRemainingPath` 추가. Task 5 블록 아래:
```ts
// --- Task 6: regenerateRemainingPath 동기화 ---
{
  const r = createRng(hashSeed("regen"));
  const day = generateDailyPath(50000, 0, "wild", r, 84);
  const fromTick = 40;
  const current = day.ticks[fromTick].price;
  const r2 = createRng(hashSeed("regen2"));
  const remain = regenerateRemainingPath(50000, current, fromTick, 0, "wild", r2, 84);
  const upper = Math.round(50000 * 1.3);
  const lower = Math.round(50000 * 0.7);
  check("regen: 틱 수 == 남은 구간", remain.length === 84 - 1 - fromTick, `len=${remain.length}`);
  check("regen: 인덱스 연속", remain.every((t, i) => t.tickIndex === fromTick + 1 + i));
  check("regen: 상하한 안", remain.every((t) => t.price >= lower && t.price <= upper));
  // 시간구조 반영: 반환 구간 로그수익률 크기가 일정치 않음(상수 σ면 분산이 매우 작게 균일)
  const absRet = remain.map((t, i) =>
    i === 0 ? Math.abs(Math.log(t.price / current)) : Math.abs(Math.log(t.price / remain[i - 1].price))
  );
  const nonzero = absRet.filter((x) => x > 0);
  check("regen: 수익률 변동 존재", nonzero.length > 0);
}
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: FAIL — `regen: 상하한 안` 등은 통과할 수 있으나, 시간구조 미반영 상태에선 구 로직이라 통과. **이 태스크는 회귀 방지 성격**이므로 Step 1 어서션이 현재 구현으로도 대부분 통과할 수 있다. 실패하지 않으면 Step 3으로 진행해 구조만 동기화하고, Step 5에서 계속 통과를 확인한다.

- [ ] **Step 3: `regenerateRemainingPath` 루프를 동일 구조로 교체**

`const sigma = TICK_SIGMA[tier] * Math.sqrt(scale);` 를 baseSigma로 바꾸고, intraday·클러스터·레짐을 적용. 기존 드리프트(window/resume/base) 로직은 그대로 둔다.

기존:
```ts
  const scale = TICKS_PER_DAY / totalTicks;
  const sigma = TICK_SIGMA[tier] * Math.sqrt(scale);
  const jumpProbability = JUMP_PROBABILITY[tier] * scale;
  // 틱당 드리프트 ...
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
```

변경:
```ts
  const scale = TICKS_PER_DAY / totalTicks;
  const baseSigma = TICK_SIGMA[tier] * Math.sqrt(scale);
  const jumpProbability = JUMP_PROBABILITY[tier] * scale;
  const intraday = intradayProfile(totalTicks);
  const regime = pickRegime(tier, rng); // RNG 1 소비 (루프 진입 전)
  let h = 1;
  // 틱당 드리프트 ... (기존 baseDriftPerTick / windowDriftPerTick / resumeDriftPerTick 유지)
  const ticks: Tick[] = [];
  const prices: number[] = [];
  let price = currentPrice;
  for (let i = fromTick + 1; i < totalTicks; i++) {
    const inWindow = i - fromTick <= windowTicks;
    const drift = baseDriftPerTick + (inWindow ? windowDriftPerTick : resumeDriftPerTick);
    const sigma = baseSigma * intraday[i] * h * regime.mult;
    price *= Math.exp(drift + sigma * nextGaussian(rng));
    h = clusterStep(h, Math.abs(nextGaussian(rng)) - MEAN_ABS_GAUSSIAN);
    if (rng() < jumpProbability) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < 0.5 ? 1 + size : 1 - size;
      h = clusterBoost(h);
    }
    price = Math.min(Math.max(price, lowerLimit), upperLimit);
    const rounded = roundPrice(price);
    prices.push(rounded);
    ticks.push({ tickIndex: i, price: rounded, isHalted: false });
  }
```

(`intraday[i]`는 절대 틱 인덱스 `i`로 접근 — 하루 시간구조와 정렬된다. VI 마킹 루프는 그대로 둔다.)

- [ ] **Step 4: 남은 곳 없는지 확인 (자체 점검)**

`regenerateRemainingPath` 안에 `TICK_SIGMA[tier] * Math.sqrt(scale)` 잔재가 없는지, `MEAN_ABS_GAUSSIAN`·`clusterStep`·`clusterBoost`·`pickRegime`·`intradayProfile`가 모두 스코프에 있는지 확인.

Run: `npm run lint`
Expected: 에러 없음.

- [ ] **Step 5: 실행해서 통과 확인**

Run: `npx tsx scripts/verify-realism.ts`
Expected: PASS — 전체 어서션 `ok`, "모든 검증 통과".

- [ ] **Step 6: 커밋**

```bash
git add scripts/verify-realism.ts src/lib/engine/randomWalk.ts
git commit -m "feat: 시세조정 경로에 동일 σ 구조 동기화"
```

---

### Task 7: 몬테카를로 밸런스 게이트 + 튜닝

`npm run simulate`로 방향중립·차익 자멸·등급 순서를 실증하고, 레짐이 우승 라인을 과하게 흔들면 `REGIME_PROB`를 튜닝한다.

**Files:**
- Modify (튜닝 시에만): `src/lib/engine/randomWalk.ts` (`REGIME_PROB`)

**Interfaces:**
- Consumes: 완성된 `generateDailyPath` (Task 1–5). `scripts/simulate.ts`는 무변경.

- [ ] **Step 1: 기준 시뮬레이션 실행 (개선 후)**

Run: `npm run simulate -- --runs 2000`
출력에서 아래 표를 읽는다: 전략별 중앙값 / 평균 / 상위10% / 최대 / 원금손실율.

- [ ] **Step 2: 채택 게이트 판정**

다음을 **모두** 만족해야 통과:
1. **차익 자멸 유지** — `지정가브라켓(...)` 4개 전략 전부 **중앙값 < 1.0배** 그리고 **원금손실율 > 50%**. (방향중립이라 브라켓이 우위를 못 가진다. 만약 브라켓 중앙값이 1배를 넘으면 **즉시 중단** — 방향성 누수가 있다는 뜻. §Step 4로.)
2. **등급 순서** — `존버(안정주)`의 원금손실율 < `잡주몰빵`의 원금손실율(안정주가 더 안전).
3. **우승 라인 안정** — `존버(분산)` 중앙값이 개선 전 대비 ±15% 이내(레짐 과열로 분포가 폭주하지 않음). 개선 전 값은 이 브랜치 base(`git stash` 불필요, 커밋 이전 값은 리뷰어가 main에서 `npm run simulate -- --runs 2000`로 별도 취득).

- [ ] **Step 3: (게이트 통과 시) 검증 스크립트 최종 실행 + 커밋**

Run: `npx tsx scripts/verify-realism.ts` → PASS 재확인.
튜닝이 없었으면 커밋할 코드 변경 없음 — Step 5로.

- [ ] **Step 4: (게이트 실패 시) 튜닝 후 재검증**

- 브라켓 중앙값 > 1배(방향성 누수): 구현 리뷰 — `driftPerTick`/`bias` 관련 코드가 σ 경로에 섞이지 않았는지, intraday/cluster/regime이 **σ에만** 곱해지는지 확인. 로직 버그를 고치고 Task 해당 커밋 수정.
- 우승 라인 폭주(존버 분산 중앙값 급등/급락): `REGIME_PROB`의 `stormy` 비중을 낮춘다. 예:
```ts
export const REGIME_PROB: Record<StockTier, [number, number, number]> = {
  stable: [0.55, 0.42, 0.03],
  normal: [0.45, 0.48, 0.07],
  wild: [0.3, 0.5, 0.2],
};
```
- 변경 후 `npm run simulate -- --runs 2000` 재실행 → Step 2 재판정. 통과하면:
```bash
git add src/lib/engine/randomWalk.ts
git commit -m "chore: 레짐 확률 밸런스 튜닝 (몬테카를로 게이트)"
```

- [ ] **Step 5: lint + build 최종 게이트**

Run: `npm run lint && npm run build`
Expected: 둘 다 성공(에러 0). (CLAUDE.md 워크플로우: 커밋 전 build+lint 통과.)

- [ ] **Step 6: 설계 문서에 확정 파라미터 기록 + 커밋**

`docs/superpowers/specs/2026-07-16-price-engine-realism-design.md` §4 하단에 "확정 파라미터(몬테카를로 게이트 통과값)" 표를 추가하고, §6 검증 결과 수치(브라켓 손실율·존버 중앙값 등)를 한 줄로 남긴다.
```bash
git add docs/superpowers/specs/2026-07-16-price-engine-realism-design.md
git commit -m "docs: 가격 엔진 리얼리티 확정 파라미터·검증 결과 기록"
```

---

## Self-Review

**Spec coverage (설계 §4 → 태스크):**
- §4.1 인트라데이 U-shape → Task 1 ✓
- §4.2 변동성 클러스터링 → Task 2 ✓
- §4.3 점프 여진 → Task 3 ✓
- §4.4 레짐 → Task 4 ✓
- §4.5 개장 갭 → Task 5 ✓
- §5 배치(regenerate 동기화) → Task 6 ✓
- §6 검증 게이트 → Task 7 ✓
- §7 리스크(RNG 소비 순서) → Task 4·5 Step 4에 "RNG 소비 순서 주의" 명시 ✓
- 불변식 I1 방향중립 → Task 7 Step 2-1 브라켓 자멸 게이트로 실증 ✓; I3 총변동성 보존 → Task 1(mean=1)·Task 2(중심화 충격) ✓; I4 상하한·VI 불변 → 전 태스크에서 해당 로직 미변경 ✓; I5 regenerate 동기화 → Task 6 ✓

**Placeholder scan:** "TBD"/"적절히"/추상 지시 없음. 모든 코드 스텝에 실제 코드·명령·기대 출력 포함.

**Type consistency:** `intradayProfile(number):number[]`, `clusterStep(number,number):number`, `clusterBoost(number):number`, `pickRegime(StockTier,Rng):{name,mult}`, `openingGapFactor(StockTier,Rng):number`, `REGIME_PROB`/`GAP_SIGMA` 레코드 — 태스크 간 이름·시그니처 일치. σ 곱 순서(`baseSigma·intraday[i]·h·regime.mult`)가 Task 2·4·6에서 동일. RNG 소비 순서(레짐 → 갭 → 틱 루프[return z, cluster z, jump])가 `generateDailyPath`와 검증 스크립트의 통계 기대에 일관.

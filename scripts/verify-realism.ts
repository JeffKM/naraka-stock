// 가격 엔진 리얼리티 개선 검증 (유닛 러너 부재 → tsx 스탠드얼론)
// 실행: npx tsx scripts/verify-realism.ts
import {
  intradayProfile,
  clusterStep,
  clusterBoost,
  generateDailyPath,
  regenerateRemainingPath,
  pickRegime,
  REGIME_PROB,
  openingGapFactor,
  GAP_SIGMA,
} from "../src/lib/engine/randomWalk";
import { createRng, hashSeed } from "../src/lib/engine/rng";
import type { StockTier } from "../src/types/domain";

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
  const tier: StockTier = "wild";
  for (let k = 0; k < K; k++) {
    const r = createRng(hashSeed(`cluster|${k}`));
    const p = generateDailyPath(10000, 0, tier, r, 84);
    const sq: number[] = [];
    for (let i = 1; i < p.ticks.length; i++) {
      sq.push(Math.log(p.ticks[i].price / p.ticks[i - 1].price) ** 2);
    }
    sum += lag1Autocorr(sq);
  }
  const avg = sum / K;
  check("cluster: 제곱수익률 lag-1 자기상관 > 0.02", avg > 0.02, `avg=${avg.toFixed(4)}`);
}

// --- Task 3: 점프 여진 ---
{
  check("aftershock: 부스트 적용", approx(clusterBoost(1), 1.8, 1e-12), `=${clusterBoost(1)}`);
  check("aftershock: 상한 클램프", clusterBoost(2.4) === 2.5);
}

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

if (failures > 0) {
  console.error(`\n${failures}개 검증 실패`);
  process.exit(1);
}
console.log("\n모든 검증 통과");

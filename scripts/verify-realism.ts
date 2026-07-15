// 가격 엔진 리얼리티 개선 검증 (유닛 러너 부재 → tsx 스탠드얼론)
// 실행: npx tsx scripts/verify-realism.ts
import {
  intradayProfile,
  clusterStep,
  generateDailyPath,
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

if (failures > 0) {
  console.error(`\n${failures}개 검증 실패`);
  process.exit(1);
}
console.log("\n모든 검증 통과");

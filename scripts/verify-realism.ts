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

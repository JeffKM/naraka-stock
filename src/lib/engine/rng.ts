// 시드 가능한 결정적 RNG (mulberry32).
// 배치는 재현 가능해야 디버깅·시뮬레이션 검증이 가능하다.
// 운영 배치는 날짜 기반 시드 + 서버 비밀값을 섞어 예측을 방지한다.

export type Rng = () => number; // [0, 1)

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 문자열 시드 → 32비트 정수 (FNV-1a)
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// 표준정규분포 난수 (Box-Muller)
export function nextGaussian(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

# 섹터 개편 Plan 3 (엔진) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 섹터 뉴스 메커니즘을 "참여확률 모델"로 재작성하고(구성원 각자 ~70% 확률로 큰 편향), 섹터 뉴스를 다건·등급화·라벨 DB 주입으로 전환하며, 남은 "27종" 코드 주석을 42종으로 정합한다.

**Architecture:** 가격 엔진(GBM 랜덤워크·틱 σ·VI·클램프)은 손대지 않고 **bias(편향) 층에서만** 섹터 영향을 주입한다. 하루에 이벤트 수를 분포 추첨(0~3개)해 서로 다른 섹터를 고르고, 각 섹터 구성원은 독립적으로 참여 판정(rng < 0.7)해 참여 시에만 ±15%p 편향을 개별 편향에 가산한다. 뉴스는 실현 경로의 섹터 평균 등락으로 등급화해 사후(장 후반) 노출한다. 밸런스 최종 튜닝·시뮬 재검증은 Plan 5 소관.

**Tech Stack:** TypeScript 5(strict), Next.js 16, Supabase(Postgres). 테스트 러너 없음 → 검증은 `npx tsx` 스크래치패드 어서션 스크립트 + `npm run build` + `npm run lint` + `npm run simulate` 스모크.

## Global Constraints

- 모든 돈 계산은 서버 Postgres 함수 — 이 Plan은 가격·돈 로직을 바꾸지 않는다(bias 층만).
- 자산은 정수(원), 부동소수점 금지. bias는 %p 단위 정수/실수 편향값(기존과 동일 범위 -30~+30 클램프).
- RNG 재현성: batch(`src/services/batchService.ts`)와 simulate(`scripts/simulate.ts`)는 **동일 시드에서 동일 결과**를 내야 한다. 두 경로의 RNG 소비 순서·횟수가 완전히 일치해야 한다. 종목 배열은 양쪽 모두 **code 오름차순** 고정.
- 이모지 금지(`no-emoji-in-ui`), 나라카 세계관 캐논 준수(`naraka-lore-canon`) — 뉴스 문안.
- TypeScript strict, `any` 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트. 개별 임포트.
- 스크래치패드 경로: `/private/tmp/claude-501/-Users-jefflee-workspace-naraka-stock/60b14db9-3ed2-4ff5-bb8e-0029270c20eb/scratchpad` (검증 스크립트는 여기 작성, 커밋하지 않음).

---

### Task 1: bias.ts — 참여확률 섹터 모델 재작성

**Files:**
- Modify: `src/lib/engine/bias.ts` (상수 블록 99~104, `SectorEvent`/`drawSectorEvent`/`applySectorEvent` 106~137, 헤더 주석 4)
- Verify(비커밋): 스크래치패드 `verify-bias.ts`

**Interfaces:**
- Consumes: `Rng`(`./rng`), `BiasTarget`/`BiasMap`(동일 파일, 기존), `pickWeighted`(동일 파일, 기존)
- Produces:
  - `export function drawSectorEvents(stocks: BiasTarget[], rng: Rng): SectorEvent[]` — 0~3개 섹터 이벤트(서로 다른 섹터). RNG 소비: 1(개수) + n×2(섹터선택·방향).
  - `export function applySectorEvents(biases: BiasMap, stocks: BiasTarget[], events: SectorEvent[], rng: Rng): BiasMap` — 이벤트별로 소속 종목을 code 순회하며 참여 판정(rng < 0.7), 참여 시 `direction*15` 가산·클램프. RNG 소비: 이벤트별 소속 종목 수만큼.
  - `interface SectorEvent { sector: string; direction: 1 | -1; magnitude: number; }` (기존 유지)
  - 상수: `SECTOR_MAGNITUDE = 15`, `SECTOR_PARTICIPATION_PROB = 0.7`, `SECTOR_UP_PROBABILITY = 0.55`, `SECTOR_EVENT_COUNT_TABLE`.
  - 기존 `drawSectorEvent`(단수)·`applySectorEvent`(단수)는 **제거**.

- [ ] **Step 1: 검증 스크립트 작성(실패 예상)**

스크래치패드에 `verify-bias.ts` 생성:

```ts
import { drawSectorEvents, applySectorEvents, type BiasTarget } from "../../src/lib/engine/bias";
import { createRng, hashSeed } from "../../src/lib/engine/rng";

// 6섹터 × 각 5종 = 30종 (참여율 측정용 큰 표본)
const sectors = ["a", "b", "c", "d", "e", "f"];
const stocks: BiasTarget[] = [];
for (const s of sectors) for (let i = 0; i < 5; i++) stocks.push({ code: `${s}${i}`, tier: "normal", sector: s });

// 1) 이벤트 수 분포 (0~3), 서로 다른 섹터
const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
let participated = 0;
let memberSlots = 0;
let magOk = true;
for (let run = 0; run < 20000; run++) {
  const rng = createRng(hashSeed(`e|${run}`));
  const events = drawSectorEvents(stocks, rng);
  counts[events.length] = (counts[events.length] ?? 0) + 1;
  if (events.length > 3) throw new Error(`이벤트 수 초과: ${events.length}`);
  const uniq = new Set(events.map((e) => e.sector));
  if (uniq.size !== events.length) throw new Error("섹터 중복");
  const base: Record<string, number> = Object.fromEntries(stocks.map((s) => [s.code, 0]));
  const applied = applySectorEvents(base, stocks, events, rng);
  for (const e of events) {
    for (const s of stocks) {
      if (s.sector !== e.sector) continue;
      memberSlots++;
      const v = applied[s.code];
      if (v !== 0) {
        participated++;
        if (Math.abs(v) !== 15) magOk = false;
      }
    }
  }
}
const total = 20000;
console.log("이벤트 수 분포:", Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, (v / total).toFixed(3)])));
const partRate = participated / memberSlots;
console.log("참여율:", partRate.toFixed(3), "| magnitude=15 일관성:", magOk);

// 2) 결정성: 같은 시드 → 같은 결과
const r1 = createRng(hashSeed("det"));
const e1 = drawSectorEvents(stocks, r1);
const b1 = applySectorEvents(Object.fromEntries(stocks.map((s) => [s.code, 0])), stocks, e1, r1);
const r2 = createRng(hashSeed("det"));
const e2 = drawSectorEvents(stocks, r2);
const b2 = applySectorEvents(Object.fromEntries(stocks.map((s) => [s.code, 0])), stocks, e2, r2);
console.log("결정성:", JSON.stringify(b1) === JSON.stringify(b2));

const ok = partRate > 0.65 && partRate < 0.75 && magOk && counts[0] > 0 && counts[3] > 0 && JSON.stringify(b1) === JSON.stringify(b2);
console.log(ok ? "PASS" : "FAIL");
if (!ok) process.exit(1);
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx <scratchpad>/verify-bias.ts`
Expected: FAIL — `drawSectorEvents` is not exported (기존은 `drawSectorEvent` 단수).

- [ ] **Step 3: bias.ts 섹터 섹션 재작성**

`src/lib/engine/bias.ts` 헤더 주석 4행을 갱신:

```ts
//   (42종 기준 ~6개). 배정 가중치는 등급별(우량 1.2 / 일반 1 / 잡주 2)
```

그리고 99~137행(섹터 이벤트 섹션 전체 = `const SECTOR_EVENT_PROBABILITY`부터 파일 끝까지)을 아래로 교체:

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx <scratchpad>/verify-bias.ts`
Expected: PASS — 참여율 ≈ 0.70, 이벤트 수 분포 ≈ {0:0.25, 1:0.35, 2:0.25, 3:0.15}, magnitude=15 일관, 결정성 true.

- [ ] **Step 5: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: `bias.ts` 자체는 통과. (호출부 batchService·simulate는 아직 구 함수명을 참조하므로 **여기서는 타입 에러가 남는다** — Task 3·4에서 해소. 이 스텝은 bias.ts 문법만 확인하는 용도이니, 빌드 에러가 batchService/simulate의 `drawSectorEvent`/`applySectorEvent` 미존재로 한정되는지만 확인하고 진행.)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/engine/bias.ts
git commit -m "feat: 섹터 뉴스 참여확률 모델 — drawSectorEvents/applySectorEvents 재작성"
```

---

### Task 2: 섹터 뉴스 등급화·라벨 주입 (templates.ts + generate.ts)

**Files:**
- Modify: `src/lib/news/templates.ts` (13행 주석, 파일 말미에 `SectorNewsGrade`·`SECTOR_NEWS_TEMPLATES` 추가)
- Modify: `src/lib/news/generate.ts` (`SECTOR_NEWS_LABEL` 제거 288~298, `SectorNewsInput`·`generateSectorNews` 재작성 300~330, `snapMagnitudeLevel` 주석 73~75, import)
- Verify(비커밋): 스크래치패드 `verify-sector-news.ts`

**Interfaces:**
- Consumes: `pickUnused`·`tickTimestamp`·`GeneratedNews`(generate.ts 기존), `NewsTemplate`(templates.ts 기존), `Rng`.
- Produces:
  - `export type SectorNewsGrade = "surgeUp" | "up" | "down" | "plungeDown"` (templates.ts)
  - `export const SECTOR_NEWS_TEMPLATES: Record<SectorNewsGrade, NewsTemplate[]>` — `{sector}` 치환 플레이스홀더, 등급당 4개(스타터; Plan 4에서 ~12개 + 섹터 플레이버로 확장). (templates.ts)
  - `export interface SectorNewsInput { sector: string; avgChangePercent: number; }` (generate.ts)
  - `export function generateSectorNews(inputs: SectorNewsInput[], labelMap: Record<string, string>, totalTicks: number, tomorrowDate: string, openHour: number, rng: Rng): GeneratedNews[]` (generate.ts)
  - 하드코딩 `SECTOR_NEWS_LABEL` 상수 **제거**.

- [ ] **Step 1: 검증 스크립트 작성(실패 예상)**

스크래치패드에 `verify-sector-news.ts` 생성:

```ts
import { generateSectorNews } from "../../src/lib/news/generate";
import { createRng, hashSeed } from "../../src/lib/engine/rng";

const labelMap = { energy: "에너지·원자력", game: "게임" };
const rng = createRng(hashSeed("sn"));
const news = generateSectorNews(
  [
    { sector: "energy", avgChangePercent: 6.2 }, // surgeUp(급등)
    { sector: "game", avgChangePercent: -6.5 }, // plungeDown(급락)
    { sector: "energy", avgChangePercent: 1.1 }, // up(강세)
  ],
  labelMap,
  144,
  "2026-08-05",
  12,
  rng
);

console.log(JSON.stringify(news, null, 2));
const allLabeled = news.every((n) => !n.title.includes("{sector}") && !n.body.includes("{sector}"));
const labelInjected = news.some((n) => n.title.includes("에너지") || n.body.includes("에너지"));
const codeHidden = news.every((n) => !n.title.includes("energy") && !n.title.includes("game"));
const nullCode = news.every((n) => n.stockCode === null);
const count = news.length === 3;
const ok = allLabeled && labelInjected && codeHidden && nullCode && count;
console.log(ok ? "PASS" : "FAIL");
if (!ok) process.exit(1);
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx <scratchpad>/verify-sector-news.ts`
Expected: FAIL — 현재 `generateSectorNews`는 `(input | null, totalTicks, tomorrowDate, openHour)` 시그니처라 배열 입력에서 타입/런타임 오류.

- [ ] **Step 3: templates.ts에 섹터 뉴스 풀 추가**

`src/lib/news/templates.ts` 13행 주석의 `27종`을 `42종`으로:

```ts
// 힌트 뉴스: 종목(42종) × 편향 등급 — ±10은 15개·0은 30개, ±20/±30은 10개 (종목당 100개).
```

파일 말미에 추가(스타터 4개/등급, `{sector}` 치환, 캐논·무이모지 준수):

```ts
// 섹터 뉴스 템플릿 (섹터 개편 Plan 3, 스펙 §5) — `{sector}` = 섹터 한국어 라벨.
// 실현 섹터 평균 등락으로 등급화: surgeUp(급등)/up(강세)/down(약세)/plungeDown(급락).
// 스타터 풀(등급당 4). Plan 4에서 등급당 ~12개 + 섹터별 플레이버 라인으로 확장.
export type SectorNewsGrade = "surgeUp" | "up" | "down" | "plungeDown";

export const SECTOR_NEWS_TEMPLATES: Record<SectorNewsGrade, NewsTemplate[]> = {
  surgeUp: [
    { title: "{sector} 업종 전반이 불을 뿜었다", body: "{sector} 관련 요괴 상점들이 하나같이 문전성시를 이뤘습니다. 골목 초입부터 줄이 길게 늘어서며 업종 전체가 들썩였습니다." },
    { title: "{sector} 거리, 오늘은 축제 분위기", body: "{sector} 관련주들이 약속이나 한 듯 큰 폭으로 뛰었습니다. 상점 요괴들은 \"이런 날은 드물다\"며 함박웃음을 지었습니다." },
    { title: "\"{sector}에 발만 걸쳐도 웃는다\" — 업종 동반 급등", body: "{sector} 전반에 손님이 몰리며 대부분의 가게가 즐거운 비명을 질렀습니다. 늦게 온 방문자들은 발을 동동 굴렀습니다." },
    { title: "{sector} 업종, 간판마다 불이 켜졌다", body: "{sector} 골목의 등불이 밤늦도록 꺼지지 않았습니다. 업종 전반에 훈풍이 불며 상인들의 발걸음이 가벼워졌습니다." },
  ],
  up: [
    { title: "{sector} 업종에 훈풍", body: "{sector} 관련 상점들이 대체로 활기를 띠었습니다. 큰 소란 없이도 손님이 꾸준히 들었습니다." },
    { title: "{sector} 거리, 오늘은 손님이 늘었다", body: "{sector} 관련주들이 완만하게 올랐습니다. 상인 요괴들은 \"오랜만에 숨통이 트인다\"고 전했습니다." },
    { title: "{sector} 업종 분위기 좋음", body: "{sector} 골목 곳곳에서 흥정 소리가 정겹게 오갔습니다. 대부분의 가게가 어제보다 나은 하루를 보냈습니다." },
    { title: "{sector}에 잔잔한 온기", body: "{sector} 관련 상점들이 소소하게 웃었습니다. 요란하진 않아도 발길이 끊이지 않은 하루였습니다." },
  ],
  down: [
    { title: "{sector} 업종에 찬바람", body: "{sector} 관련 상점들이 대체로 한산했습니다. 상인 요괴들은 처마 밑에서 하늘만 올려다봤습니다." },
    { title: "{sector} 거리, 오늘은 손님이 뜸했다", body: "{sector} 관련주들이 완만하게 밀렸습니다. \"이런 날도 있는 법\"이라며 상인들은 서로를 다독였습니다." },
    { title: "{sector} 업종 분위기 가라앉아", body: "{sector} 골목의 흥정 소리가 눈에 띄게 잦아들었습니다. 대부분의 가게가 어제보다 조용한 하루를 보냈습니다." },
    { title: "{sector}에 옅은 그늘", body: "{sector} 관련 상점들이 소소하게 웅크렸습니다. 큰 소란은 없었지만 발길이 성겼습니다." },
  ],
  plungeDown: [
    { title: "{sector} 업종 전반이 얼어붙었다", body: "{sector} 관련 요괴 상점들이 하나같이 문을 일찍 닫았습니다. 골목 전체에 한기가 돌며 업종이 크게 흔들렸습니다." },
    { title: "{sector} 거리, 오늘은 발길이 뚝 끊겼다", body: "{sector} 관련주들이 약속이나 한 듯 큰 폭으로 밀렸습니다. 상점 요괴들은 \"이런 날은 처음\"이라며 한숨을 쉬었습니다." },
    { title: "\"{sector}는 오늘 쉬어간다\" — 업종 동반 급락", body: "{sector} 전반에서 손님이 빠지며 대부분의 가게가 울상을 지었습니다. 상인들은 서로의 어깨를 두드렸습니다." },
    { title: "{sector} 업종, 간판 불이 하나둘 꺼졌다", body: "{sector} 골목의 등불이 초저녁부터 꺼졌습니다. 업종 전반에 찬바람이 불며 상인들의 어깨가 처졌습니다." },
  ],
};
```

- [ ] **Step 4: generate.ts 섹터 뉴스 재작성**

`src/lib/news/generate.ts`:

(a) `SECTOR_NEWS_TEMPLATES`·`SectorNewsGrade`를 templates.ts에서 임포트(파일 상단 templates 임포트 블록에 추가):

```ts
import {
  // ...기존 임포트 유지...
  SECTOR_NEWS_TEMPLATES,
  type SectorNewsGrade,
} from "./templates";
```

(b) 73~75행 `snapMagnitudeLevel` 위 주석의 stale한 "±8%p" 예시를 갱신:

```ts
// 결합 편향(개별 이벤트 + 섹터 참여분 ±15%p)은 템플릿 세기(10/20/30)와 정확히
// 일치하지 않을 수 있어(예: 10+15=25, 20-15=5) 가장 가까운 세기로 스냅한다.
// 순수 개별 이벤트(10/20/30)는 그대로 자기 자신에 스냅되어 기존 동작과 동일하다.
```

(c) 288~330행(주석 `// 섹터 뉴스 (피드백 3)`부터 `generateSectorNews` 끝 `}`까지)을 아래로 교체:

```ts
// 섹터 뉴스 (섹터 개편 Plan 3, 스펙 §4.4): 섹터 이벤트를 설명하는 정식뉴스.
// 이벤트당 1건(stock_code=null, 섹터 전체). 세기는 그 섹터 구성원의 실현 일간 평균
// 등락으로 등급화하고, 방향은 실현 결과 기준이다. 노출은 정식뉴스와 동일하게 장
// 후반(0.8 지점) — 사후 설명이라 추종 이득이 없다. 라벨은 sectors.label_ko를 주입받는다.
export interface SectorNewsInput {
  sector: string; // 섹터 코드
  avgChangePercent: number; // 그 섹터 구성원의 실현 평균 등락률(%)
}

// 실현 평균 등락률 → 등급. 임계 ±4%(콘텐츠 파라미터, 밸런스 무관).
function gradeSector(avg: number): SectorNewsGrade {
  if (avg >= 4) return "surgeUp";
  if (avg >= 0) return "up";
  if (avg > -4) return "down";
  return "plungeDown";
}

// 섹터 이벤트 목록 → 섹터 뉴스 다건. 라벨맵으로 코드→한국어 치환.
export function generateSectorNews(
  inputs: SectorNewsInput[],
  labelMap: Record<string, string>,
  totalTicks: number,
  tomorrowDate: string,
  openHour: number,
  rng: Rng
): GeneratedNews[] {
  const tick = Math.min(totalTicks - 1, Math.floor(totalTicks * 0.8));
  // 같은 등급이 여러 건이면 같은 배치 안에서 제목 중복을 피한다.
  const usedByGrade: Record<SectorNewsGrade, Map<string, number>> = {
    surgeUp: new Map(),
    up: new Map(),
    down: new Map(),
    plungeDown: new Map(),
  };
  return inputs.map((input) => {
    const label = labelMap[input.sector] ?? input.sector;
    const grade = gradeSector(input.avgChangePercent);
    const used = usedByGrade[grade];
    const tmpl = pickUnused(rng, SECTOR_NEWS_TEMPLATES[grade], used);
    used.set(tmpl.title, (used.get(tmpl.title) ?? 0) + 1);
    return {
      date: tomorrowDate,
      stockCode: null,
      grade: "news" as const,
      title: tmpl.title.replaceAll("{sector}", label),
      body: tmpl.body.replaceAll("{sector}", label),
      publishedAt: tickTimestamp(tomorrowDate, tick, openHour),
    };
  });
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx tsx <scratchpad>/verify-sector-news.ts`
Expected: PASS — 3건 생성, `{sector}` 전부 치환, "에너지" 라벨 주입, 섹터 코드 미노출, stockCode 전부 null.

- [ ] **Step 6: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: `generate.ts`·`templates.ts` 통과. (batchService의 구 `generateSectorNews` 호출부는 Task 3에서 신규 시그니처로 교체 — 여기서 남는 타입 에러가 batchService 한정인지 확인.)

- [ ] **Step 7: 커밋**

```bash
git add src/lib/news/templates.ts src/lib/news/generate.ts
git commit -m "feat: 섹터 뉴스 등급화·라벨 DB 주입, SECTOR_NEWS_LABEL 하드코딩 제거"
```

---

### Task 3: batchService.ts — 신규 엔진 배선 + 섹터 라벨 조회 + 등급 입력 계산

**Files:**
- Modify: `src/services/batchService.ts` (import 2·9, 섹터 이벤트 블록 96~133, 섹터 뉴스 호출 211~219)
- Verify: `npm run build && npm run lint` + DB 스모크(선택, 아래)

**Interfaces:**
- Consumes: `drawSectorEvents`·`applySectorEvents`(Task 1), `generateSectorNews`·`SectorNewsInput`(Task 2), Supabase 클라이언트(기존).
- Produces: 없음(배치 내부 배선). apply_daily_batch RPC 페이로드는 불변.

- [ ] **Step 1: import 교체**

`src/services/batchService.ts` 2행:

```ts
import { applySectorEvents, drawDailyBiases, drawSectorEvents, realizeBias } from "@/lib/engine/bias";
```

9행 근처 news 임포트 블록에 `SectorNewsInput` 추가(기존 `generateSectorNews` 유지):

```ts
  generateSectorNews,
  type SectorNewsInput,
```

- [ ] **Step 2: 섹터 라벨 조회 추가**

`stocks` 조회(101~106행) 직후에 sectors 라벨 맵을 로드(quoteService.ts:61-62 패턴):

```ts
  const { data: sectorRows, error: sectorsError } = await supabase
    .from("sectors")
    .select("code, label_ko");
  if (sectorsError) throw sectorsError;
  const sectorLabelMap: Record<string, string> = {};
  for (const row of sectorRows ?? []) sectorLabelMap[row.code] = row.label_ko;
```

- [ ] **Step 3: 섹터 이벤트 블록 교체**

126~133행(`const individualBiases = ...`부터 `biases = applySectorEvent(...)`까지)을 교체:

```ts
    const individualBiases = drawDailyBiases(biasTargets, rng);
    // 섹터 이벤트 (참여확률 모델, Plan 3): 서로 다른 섹터 0~3개를 뽑고 구성원 각자
    // 70% 확률로 참여시킨다. RNG 소비 순서상 drawDailyBiases 직후·경로 생성 루프
    // 진입 전에 호출해야 시드 재현성이 유지된다. applySectorEvents는 참여 판정으로
    // RNG를 소비하므로(구 단수 버전과 달리 순수 병합이 아님) 이 순서가 중요하다.
    const sectorEvents = drawSectorEvents(biasTargets, rng);
    // 가격 경로·요약·섹터 판정용 결합 편향(개별 + 섹터 참여분). 조기 방향뉴스 후보
    // 선정에는 쓰지 않는다 — 아래 pickEarlySignalTargets 호출부 주석 참고.
    biases = applySectorEvents(individualBiases, biasTargets, sectorEvents, rng);
```

- [ ] **Step 4: 섹터 뉴스 호출 교체(등급 입력 계산 포함)**

211~219행(`// 섹터 뉴스 (피드백 3)` 주석 + `news.push(...generateSectorNews(...))`)을 교체:

```ts
    // 섹터 뉴스 (Plan 3): 이벤트별 1건. 실현 종가로 섹터 구성원 평균 등락을 계산해 등급화.
    const closeByCode: Record<string, number> = {};
    for (const s of summaries) closeByCode[s.stock_code as string] = s.close as number;
    const sectorNewsInputs: SectorNewsInput[] = sectorEvents.map((event) => {
      const members = biasTargets.filter((t) => t.sector === event.sector);
      const changes = members.map((m) => {
        const close = closeByCode[m.code];
        const prev = prevCloses[m.code];
        return prev > 0 ? ((close - prev) / prev) * 100 : 0;
      });
      const avg =
        changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
      return { sector: event.sector, avgChangePercent: avg };
    });
    news.push(
      ...generateSectorNews(
        sectorNewsInputs,
        sectorLabelMap,
        config.ticksPerDay,
        tomorrowDate,
        config.openHour,
        rng
      )
    );
```

- [ ] **Step 5: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: PASS — batchService 타입 에러 해소(구 함수명 참조 제거). simulate.ts는 Task 4 전까지 여전히 구 함수 참조로 에러가 남을 수 있으니, 남는 에러가 simulate 한정인지 확인.

- [ ] **Step 6: (선택) DB 스모크**

로컬 스택이 떠 있으면(`npx supabase start`) 배치가 크래시 없이 도는지 확인:

```bash
npx supabase db reset >/dev/null 2>&1
curl -s -X POST "localhost:3000/api/cron/daily-batch?date=2026-07-31" -H "Authorization: Bearer $CRON_SECRET" | head -c 400
```
Expected: `success` 응답. (dev 서버 필요. 스택 미가동이면 이 스텝은 건너뛰고 Task 3 최종 verify는 Plan 3 종료 시 verify 스킬로 대체.)

- [ ] **Step 7: 커밋**

```bash
git add src/services/batchService.ts
git commit -m "feat: 배치에 참여확률 섹터 이벤트·섹터 라벨 주입·뉴스 등급 배선"
```

---

### Task 4: simulate.ts — 신규 시그니처·RNG 순서 정합

**Files:**
- Modify: `scripts/simulate.ts` (import 8~14, 섹터 이벤트 블록 90~93, 주석 29·91)
- Verify: `npm run build && npm run lint` + `npm run simulate -- --runs 200`

**Interfaces:**
- Consumes: `drawSectorEvents`·`applySectorEvents`(Task 1).
- Produces: 없음(시뮬레이터 내부).

**중요:** 이 Task는 **함수 시그니처·RNG 순서만** 배치와 정합시킨다. `STOCKS` 배열은 아직 구 27종 로스터·구 기준가다 — **42종/신규 기준가로의 갱신과 밸런스 재검증은 Plan 5 소관**(메모리·스펙 §7). 여기서 나오는 배수 수치는 최종 밸런스 판단용이 아니라 "엔진이 크래시 없이 도는지 + 분포가 비상식적이지 않은지" 스모크다.

- [ ] **Step 1: import 교체**

`scripts/simulate.ts` 8~14행:

```ts
import {
  applySectorEvents,
  drawDailyBiases,
  drawSectorEvents,
  realizeBias,
  type BiasMap,
} from "../src/lib/engine/bias";
```

- [ ] **Step 2: 섹터 이벤트 블록 교체**

90~93행(`let biases = drawDailyBiases(...)`부터 `biases = applySectorEvent(...)`까지)을 교체:

```ts
    let biases = drawDailyBiases(STOCKS, rng);
    // 섹터 이벤트 (참여확률 모델, Plan 3): 배치와 동일하게 drawDailyBiases 직후·경로
    // 생성 전에 뽑고 가산한다. applySectorEvents는 참여 판정으로 RNG를 소비하므로
    // 이 순서·소비량이 batchService와 정확히 일치해야 동일 시드에서 동일 결과가 난다.
    const sectorEvents = drawSectorEvents(STOCKS, rng);
    biases = applySectorEvents(biases, STOCKS, sectorEvents, rng);
```

- [ ] **Step 3: 29행 주석의 구 함수명 갱신**

29행 `drawDailyBiases·drawSectorEvent가` → `drawDailyBiases·drawSectorEvents가`:

```ts
// 배열 순서는 code 오름차순(리뷰 결함 수정, 2026-07-17): drawDailyBiases·drawSectorEvents가
```

- [ ] **Step 4: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: PASS — 전체 통과(구 함수 참조가 모두 사라짐).

- [ ] **Step 5: 시뮬 스모크**

Run: `npm run simulate -- --runs 200`
Expected: 크래시 없이 완주. 전략별 배수 출력이 나오고 NaN/무한대가 없다. (수치 자체의 밸런스 판정은 Plan 5.)

- [ ] **Step 6: 커밋**

```bash
git add scripts/simulate.ts
git commit -m "refactor: 시뮬레이터를 참여확률 섹터 모델 시그니처로 정합"
```

---

### Task 5: 남은 "27종" 주석 → 42종 정합

**Files:**
- Modify: `src/app/news/page.tsx:25`
- Modify: `src/app/api/cron/daily-batch/route.ts:4`
- Modify: `src/components/layout/MarketGridBackdrop.tsx:17`
- Verify: `grep` + `npm run build`

(참고: `bias.ts`·`templates.ts`의 27종 주석은 각각 Task 1·2에서 이미 갱신됨. 이 Task는 나머지 3곳.)

- [ ] **Step 1: news/page.tsx**

25행 주석:

```tsx
        {/* 종목 필터 — 42종을 한 줄 가로 스크롤로 (여러 줄 wrap 방지) */}
```

- [ ] **Step 2: daily-batch/route.ts**

4행 주석:

```ts
// 배치는 42종목 하루치 틱 전량 생성 + 뉴스 추첨이라 기본 실행 제한(10초)을 넘길 수 있다.
```

- [ ] **Step 3: MarketGridBackdrop.tsx**

17행 주석:

```tsx
// 실제 상장 종목(42종 개편 로스터) + 지수(NASPI/NASDAK) 코드를 그대로 사용해 세계관을 유지한다.
```

- [ ] **Step 4: 잔여 확인**

Run: `grep -rn "27종\|27개\|27종목" src/ scripts/`
Expected: 출력 없음(모든 "27종" 주석이 42종으로 갱신됨).

- [ ] **Step 5: 빌드**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/app/news/page.tsx src/app/api/cron/daily-batch/route.ts src/components/layout/MarketGridBackdrop.tsx
git commit -m "docs: 남은 27종 코드 주석 42종으로 정합"
```

---

## Plan 3 종료 후 (이 Plan 범위 밖 — 기록용)

- **실앱 verify:** `verify` 스킬(dev + agent-browser)로 뉴스 피드에 섹터 뉴스가 신규 섹터 한국어 라벨로(코드 미노출) 뜨는지 확인. 로컬 배치 재생성 필요.
- **Plan 5로 이월:** simulate `STOCKS` 42종/신규 기준가 갱신 + 1,000만 반영 밸런스 재검증·튜닝(`SECTOR_MAGNITUDE`/`SECTOR_PARTICIPATION_PROB`/이벤트 수 분포), 섹터 뉴스 템플릿 등급당 ~12개 확장은 Plan 4.

## Self-Review

- **스펙 커버리지(§4·§5 + 이월 항목):**
  - §4.2 파라미터(magnitude 15·참여율 0.7·이벤트 수 분포) → Task 1 ✅
  - §4.3 알고리즘(drawSectorEvents→applySectorEvents→경로, RNG 순서) → Task 1·3·4 ✅
  - §4.4 섹터 뉴스 다건·실현 평균 등급화·후반 노출·라벨 주입 → Task 2·3 ✅
  - §3.3-2 `SECTOR_NEWS_LABEL` 제거·DB 주입 → Task 2·3 ✅
  - §5 섹터 뉴스 템플릿(등급별 풀) → Task 2 스타터, Plan 4 확장(명시) ✅
  - "27종" 주석 갱신 → Task 1·2·5 ✅
  - simulate 정합 → Task 4 ✅ (42종 로스터/밸런스 재검증은 Plan 5 명시 이월)
- **플레이스홀더 스캔:** 모든 코드 스텝에 완성 코드 포함, TODO/TBD 없음 ✅
- **타입 일관성:** `SectorEvent`(sector/direction/magnitude), `SectorNewsInput`(sector/avgChangePercent), `SectorNewsGrade`(4값), `generateSectorNews`(inputs/labelMap/totalTicks/tomorrowDate/openHour/rng) — Task 1·2·3 전반 동일 시그니처 사용 ✅

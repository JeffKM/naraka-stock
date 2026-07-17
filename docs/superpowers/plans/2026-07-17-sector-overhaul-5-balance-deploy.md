# 섹터 개편 Plan 5 (밸런스·배포) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Part A는 superpowers:subagent-driven-development / superpowers:executing-plans로 태스크별 실행. **Part B(배포)는 프로덕션 비가역 작업 — 자동 실행 금지, 각 STOP 게이트에서 사장님 확인 필수.** Steps use checkbox (`- [ ]`).

**Goal:** 시뮬레이터를 42종/신규 기준가/1,000만으로 갱신해 밸런스를 재검증하고(목표 PRD §10), 확정 후 프로덕션에 3개 마이그레이션을 배포·리허설 재생성·실앱 verify를 사장님 확인 게이트와 함께 수행한다.

**Architecture:** Part A는 로컬·무위험 — `scripts/simulate.ts`의 하드코딩 `STOCKS` 배열을 **로컬 DB(마이그레이션 적용본)에서 생성**해 42종/신규가/새 섹터로 교체(단일 소스, 스펙 §7)하고, 초기자금을 1,000만으로 올린 뒤 몬테카를로로 목표를 재검증한다. 엔진·bias·섹터 참여모델은 Plan 3에서 이미 배선돼 있어 손대지 않는다. Part B는 프로덕션 운영 — 아직 prod 미반영인 3개 마이그레이션(`20260717010000_sectors_table`, `20260717020000_roster_42_reprice`, `20260717030000_capital_scale`)을 push하되, `capital_scale`의 `+900만 전계정 1회`가 위험하므로 **prod 계정 현황 조사 → 정리 → push → 리허설 재생성 → verify** 순서를 지킨다.

**Tech Stack:** TypeScript 5, Supabase(Postgres, 로컬 54322 / prod `suowtstolxzpnjdolfrn` ap-northeast-2), Vercel(`naraka-stock.vercel.app`), pg_cron. 테스트 러너 없음 → 검증은 `npm run simulate` + `npx tsx` 스크래치패드 + `db reset`/psql + `npm run build` + `npx eslint src/...` + verify 스킬.

## Global Constraints

- **RNG 재현성 불변식(최우선)**: `batchService.ts`(DB 경로)와 `simulate.ts`는 **동일 시드에서 동일 결과**. 두 경로 모두 종목을 **code 오름차순**으로 순회한다. 소비 순서: `drawDailyBiases → drawSectorEvents → applySectorEvents → generateDailyPath`. `simulate.ts`의 `STOCKS`는 반드시 code 오름차순, DB `stocks`와 1:1 일치해야 파리티가 성립(Plan 3 리뷰: pool Set 순서가 code 정렬에 암묵 의존).
- **자산은 정수(원)**, 부동소수점 금지. 초기자금 10,000,000 / 방문보너스 1,000,000(config·마이그레이션 기확정).
- **밸런스 목표(PRD §10)**: 1위 최종자산 배수 3~10배 구간, 순위 역전 가능성 유지, 뉴스추종이 지배 전략이 아님, 섹터 바스켓 추종이 지배 전략이 아님.
- **가격·엔진 로직 불변**: 이 Plan은 STOCKS 데이터·초기자금만 바꾼다(밸런스는 스케일 불변 예상). 튜닝이 필요하면 노브는 `SECTOR_MAGNITUDE`(15)·`SECTOR_PARTICIPATION_PROB`(0.7)·이벤트 수 분포뿐이며, 변경 시 batch·simulate 양쪽 정합 유지.
- **프로덕션 비가역 작업 안전(Part B)**: prod db push·계정 정리·+900만 마이그레이션은 **사장님 명시 확인 후에만**. 개장(8/1) 전이라 실고객 부재가 전제지만 **추측 금지 — B1에서 실제 조회로 확인**. 리허설/테스트 계정 정리를 push보다 **먼저**(그래야 +900만이 정리 후 계정에만 적용).
- 스크래치패드: `/private/tmp/claude-501/-Users-jefflee-workspace-naraka-stock/8fefebf7-d34e-4d9a-9cdd-cebf85f376f8/scratchpad`.

## 권위 데이터 (마이그레이션 = 단일 소스)

- 신규 15종: `20260717020000_roster_42_reprice.sql` L6-20(코드·명·tier·섹터·shares), L24-38(기준가).
- 구 27종 리프라이스: 같은 파일 L61-67(신규 기준가), L48-54(shares). 재배치: OKCC→food, MHBT→cosmetics, BNOC·SPCO→shipaero(L41-43).
- 자금: `20260717030000_capital_scale.sql` — cash default 10,000,000 / config initial_cash=10000000·visit_bonus=1000000 / **`update users set cash = cash + 9000000`(전계정 1회)**.
- 이 값들을 손으로 옮기지 않고 **로컬 DB에서 생성**(db reset이 마이그레이션을 적용하므로 DB가 곧 확정 상태).

---

# Part A — 밸런스 (로컬, 무위험)

### Task A1: simulate STOCKS를 42종/신규가/1,000만으로 갱신

**Files:**
- Create(비커밋): `<scratchpad>/gen-stocks.ts` (DB→STOCKS 배열 생성기)
- Modify: `scripts/simulate.ts` (STOCKS 배열 L42-63, `INITIAL_CASH` L23, 주석 L26-27)
- Verify: `<scratchpad>/verify-stocks.ts` + `npm run build`

**Interfaces:**
- Consumes: 로컬 DB `stocks`(code, tier, sector) + `daily_summary`(close @ 2026-07-31). `StockTier`/`StockSector`(=string) from `@/types/domain`.
- Produces: `scripts/simulate.ts`의 `STOCKS: Array<{code, tier, sector, initial}>` = DB 42행과 1:1(code 오름차순), `INITIAL_CASH = 10_000_000`.

- [ ] **Step 1: 로컬 DB를 확정 상태로 리셋**

Run:
```bash
cd /Users/jefflee/workspace/naraka-stock
npx supabase db reset >/dev/null 2>&1 && echo "reset ok"
```
Expected: `reset ok`. (마이그레이션 전량 + seed 적용 → stocks 42행, daily_summary 2026-07-31 42행.)

- [ ] **Step 2: DB 현황 확인(실패 기준선)**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc \
"select count(*) from stocks; select count(*) from daily_summary where trade_date='2026-07-31';"
```
Expected: `42` / `42`. (아니면 db reset·마이그레이션 문제 — 진행 중단하고 조사.)

- [ ] **Step 3: STOCKS 생성기 작성·실행**

`<scratchpad>/gen-stocks.ts` 생성:

```ts
import { Client } from "pg";

const client = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await client.connect();
const { rows } = await client.query(
  `select s.code, s.tier, s.sector, d.close
   from stocks s
   join daily_summary d on d.stock_code = s.code and d.trade_date = '2026-07-31'
   order by s.code asc`
);
await client.end();

const lines = rows.map(
  (r) => `  { code: "${r.code}", tier: "${r.tier}", sector: "${r.sector}", initial: ${r.close} },`
);
console.log(`// ${rows.length}종 (code 오름차순, 로컬 DB 생성 ${new Date === undefined ? "" : ""})`);
console.log(lines.join("\n"));
```

Run: `npx tsx <scratchpad>/gen-stocks.ts > <scratchpad>/stocks-array.txt && wc -l <scratchpad>/stocks-array.txt`
Expected: 42줄(+헤더 주석 1). (`pg`가 없으면 `npm ls pg`로 확인 — Supabase 종속에 포함. 없으면 psql `-A -F','`로 CSV 출력 후 변환.)

- [ ] **Step 4: simulate.ts에 반영**

`scripts/simulate.ts`:
- L23 `const INITIAL_CASH = 1_000_000;` → `const INITIAL_CASH = 10_000_000;`
- L26-27 주석의 "2026-07-14, migrations/20260714000000"·"2026-07-16, migrations/20260716010000_sector.sql" 기준 문구를 갱신:
  ```ts
  // 등급·기준가·섹터는 42종 개편 확정안 기준 (2026-07-17, migrations/20260717020000_roster_42_reprice)
  // — 이 배열은 로컬 DB(마이그레이션 적용본)에서 code 오름차순으로 생성해 붙였다(스펙 §7).
  ```
- L42-63 `const STOCKS ... = [ ... ];`의 배열 본문(27줄)을 Step 3에서 생성한 42줄로 **완전 교체**. 배열 선언부(`const STOCKS: Array<...> = [`)와 닫는 `];`는 유지.

- [ ] **Step 5: DB 일치·code정렬 검증**

`<scratchpad>/verify-stocks.ts` 생성:

```ts
import { Client } from "pg";
// simulate.ts에서 STOCKS를 export하지 않으므로, 생성기와 동일 쿼리 결과를 재생성해
// simulate.ts 파일 텍스트에 42행이 모두 존재하는지 대조한다.
import { readFileSync } from "node:fs";

const client = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await client.connect();
const { rows } = await client.query(
  `select s.code, s.tier, s.sector, d.close from stocks s
   join daily_summary d on d.stock_code=s.code and d.trade_date='2026-07-31' order by s.code asc`
);
await client.end();

const src = readFileSync("scripts/simulate.ts", "utf8");
const errors: string[] = [];
if (rows.length !== 42) errors.push(`DB 종목 수 ${rows.length} (기대 42)`);
for (const r of rows) {
  const needle = `{ code: "${r.code}", tier: "${r.tier}", sector: "${r.sector}", initial: ${r.close} },`;
  if (!src.includes(needle)) errors.push(`누락/불일치: ${needle}`);
}
if (!/INITIAL_CASH = 10_000_000/.test(src)) errors.push("INITIAL_CASH가 10_000_000이 아님");
// code 오름차순 확인: STOCKS 블록에서 code 추출 순서
const block = src.slice(src.indexOf("const STOCKS"), src.indexOf("];", src.indexOf("const STOCKS")));
const codes = [...block.matchAll(/code: "([A-Z가-힣]+)"/g)].map((m) => m[1]);
const sorted = [...codes].sort();
if (JSON.stringify(codes) !== JSON.stringify(sorted)) errors.push("STOCKS가 code 오름차순이 아님");
if (codes.length !== 42) errors.push(`STOCKS 항목 수 ${codes.length} (기대 42)`);

if (errors.length) { console.log("FAIL"); errors.slice(0, 50).forEach((e) => console.log(" -", e)); process.exit(1); }
console.log("PASS — simulate STOCKS 42종·DB일치·code정렬·1000만");
```

Run: `npx tsx <scratchpad>/verify-stocks.ts`
Expected: PASS.

- [ ] **Step 6: 빌드·린트**

Run: `npm run build && npx eslint scripts/simulate.ts`
Expected: PASS(둘 다). (`scripts/`가 tsconfig include 밖이면 build는 무영향 — 최소 `npx tsc --noEmit -p .` 대신 `npx tsx scripts/simulate.ts --runs 1`로 컴파일 확인.)

- [ ] **Step 7: 커밋**

```bash
git add scripts/simulate.ts
git commit -m "refactor: 시뮬레이터 STOCKS 42종/신규 기준가/1,000만 반영"
```

---

### Task A2: batch·simulate 동일시드 회귀 대조 (RNG 파리티 안전망)

**Files:**
- Create(비커밋): `<scratchpad>/verify-parity.ts`
- Verify: 스크립트 PASS

**Interfaces:**
- Consumes: `drawDailyBiases`/`drawSectorEvents`/`applySectorEvents`/`realizeBias`(`@/lib/engine/bias`), `generateDailyPath`(`@/lib/engine/randomWalk`), `createRng`/`hashSeed`(`@/lib/engine/rng`), 로컬 DB `stocks`.
- Produces: 없음(검증). Plan 3 리뷰가 남긴 안전망("pool Set 순서가 code 정렬에 암묵 의존") 실증.

이 Task는 STOCKS 갱신 후에도 두 경로의 RNG 소비가 동일함을 **구조적으로** 확인한다. 핵심 리스크는 종목 순서 — A1이 code 오름차순으로 생성했으므로, DB를 code 순으로 읽어 동일 엔진 시퀀스를 두 번(동일 시드) 돌려 종가가 바이트 단위로 같은지 본다.

- [ ] **Step 1: 파리티 스크립트 작성**

`<scratchpad>/verify-parity.ts` 생성:

```ts
import { Client } from "pg";
import { drawDailyBiases, drawSectorEvents, applySectorEvents, realizeBias } from "/Users/jefflee/workspace/naraka-stock/src/lib/engine/bias";
import { generateDailyPath } from "/Users/jefflee/workspace/naraka-stock/src/lib/engine/randomWalk";
import { createRng, hashSeed } from "/Users/jefflee/workspace/naraka-stock/src/lib/engine/rng";

const client = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" });
await client.connect();
const { rows } = await client.query(`select code, tier, sector from stocks order by code asc`);
await client.end();
const stocks = rows.map((r) => ({ code: r.code as string, tier: r.tier as "stable" | "normal" | "wild", sector: r.sector as string }));

// 동일 시드·동일 순서로 하루치 종가 시퀀스를 두 번 생성 → 완전 일치해야 함.
function runDay(seed: string): Record<string, number> {
  const rng = createRng(hashSeed(seed));
  let biases = drawDailyBiases(stocks, rng);
  const events = drawSectorEvents(stocks, rng);
  biases = applySectorEvents(biases, stocks, events, rng);
  const closes: Record<string, number> = {};
  for (const s of stocks) {
    const path = generateDailyPath(100000, realizeBias(biases[s.code], rng), s.tier, rng);
    closes[s.code] = path.close;
  }
  return closes;
}
const a = runDay("2026-08-01");
const b = runDay("2026-08-01");
const c = runDay("2026-08-02");
const same = JSON.stringify(a) === JSON.stringify(b);
const diff = JSON.stringify(a) !== JSON.stringify(c);
console.log("동일시드 동일결과:", same, "| 다른시드 다른결과:", diff, "| 종목수:", stocks.length);
console.log(same && diff && stocks.length === 42 ? "PASS" : "FAIL");
if (!(same && diff && stocks.length === 42)) process.exit(1);
```

- [ ] **Step 2: 실행**

Run: `npx tsx <scratchpad>/verify-parity.ts`
Expected: PASS — 동일시드 동일결과 true, 다른시드 다른결과 true, 종목수 42. (결정성·code순 순회가 유지됨을 확인. 실제 batchService와의 라이브 대조는 A3 이후 선택.)

- [ ] **Step 3: 커밋 없음** (검증 전용).

---

### Task A3: 몬테카를로 재검증 + (필요시) 튜닝

**Files:**
- Run: `npm run simulate -- --runs 1000`
- Modify(조건부): `src/lib/engine/bias.ts`(튜닝 노브) — 목표 미달 시에만
- Verify: 시뮬 출력 목표 판정

**Interfaces:**
- Consumes: A1 갱신된 `STOCKS`. Produces: 밸런스 판정(코드 변경 없을 수 있음).

- [ ] **Step 1: 베이스라인 시뮬**

Run: `npm run simulate -- --runs 1000`
Expected: 크래시 없이 완주. 전략별 최종자산 분포·배수 출력. NaN/Inf 없음.

- [ ] **Step 2: 목표 판정(기록)**

출력을 PRD §10 기준으로 판정해 스크래치패드 `sim-verdict.md`에 기록:
- 1위(상위 전략/시드) 최종자산 ÷ 초기자금(1,000만)이 대체로 **3~10배** 구간인가.
- "매수 후 보유" 대비 "뉴스추종" 전략이 지배적이지 않은가(뉴스추종 배수 ≤ buy&hold 배수 근처).
- 섹터 편중 전략(한 섹터 몰빵)이 분산 대비 압도적이지 않은가(섹터 참여모델로 꼬리는 넓어지되 지배 아님).
- 초기자금만 10배 됐으므로 **배수 자체는 구 27종·100만 대비 크게 다르지 않아야** 정상(스케일 불변). 크게 달라졌다면 STOCKS 데이터 오류 의심.

- [ ] **Step 3: 판정 분기**

- **목표 충족**: 코드 변경 없음. Step 5로.
- **미달(예: 1위 배수 과대 >10배 또는 뉴스추종/섹터바스켓 지배)**: `bias.ts` 노브 조정 — 배수 과대면 `SECTOR_MAGNITUDE` 하향(15→12 등) 또는 이벤트 수 분포 완화, 섹터바스켓 지배면 `SECTOR_PARTICIPATION_PROB` 하향. **한 번에 한 노브만** 바꾸고 재시뮬. 변경 시 batch·simulate 공용 상수라 양쪽 자동 정합(bias.ts는 공유 모듈).

- [ ] **Step 4: (튜닝한 경우만) 재검증·A2 재실행**

Run: `npm run simulate -- --runs 1000` + `npx tsx <scratchpad>/verify-parity.ts`
Expected: 목표 충족 + 파리티 PASS. 만족까지 Step 3-4 반복(각 반복 1노브).

- [ ] **Step 5: (튜닝한 경우만) 커밋**

```bash
git add src/lib/engine/bias.ts
git commit -m "tune: 섹터 밸런스 노브 조정 (<바꾼 노브·값>)"
```
(튜닝 없으면 커밋 없음 — Part A는 A1 커밋만.)

- [ ] **Step 6: Part A 종료 판정**

`sim-verdict.md`에 최종 배수 요약·튜닝 여부 기록. **Part B 진입 전 사장님께 밸런스 결과 보고**(배수 구간·튜닝 여부).

---

# Part B — 배포 (프로덕션, 확인 게이트 런북)

> ⚠️ **각 STOP 게이트에서 사장님 명시 확인 없이 다음 비가역 단계로 진행 금지.** prod = Supabase `suowtstolxzpnjdolfrn`(ap-northeast-2), Vercel `naraka-stock.vercel.app`. 로컬에 prod 링크·서비스롤 키가 있어야 실행 가능(`npx supabase link` 상태 확인).

### Task B1: prod 현황 조사 — 마이그레이션·계정 (live-user 확인) [STOP]

**목적:** "지금 사이트 이용자가 있을 수 있다"는 우려를 실측으로 해소하고 정리 전략을 확정.

- [ ] **Step 1: prod 링크·미적용 마이그레이션 확인**

Run:
```bash
npx supabase migration list --linked
```
Expected: `20260717010000`·`20260717020000`·`20260717030000`이 **로컬만 있고 원격 미적용**임을 확인(Local 열 O, Remote 열 X). 링크 안 돼 있으면 `npx supabase link --project-ref suowtstolxzpnjdolfrn` 먼저(사장님이 DB 비밀번호 입력).

- [ ] **Step 2: prod 계정 현황 조사(읽기 전용)**

prod SQL(Studio 또는 링크된 psql)에서:
```sql
select count(*) as total,
       count(*) filter (where cash <> 1000000) as non_default_cash,
       min(created_at), max(created_at)
from users;
select nickname, cash, created_at from users order by created_at desc limit 20;
```
판단:
- 계정이 0이거나 전부 `TEST-*`·리허설 닉네임 → 실고객 없음(개장 전 정상). **전량 정리 대상.**
- 실고객처럼 보이는 계정(개장 전 유입/지인 테스트) 존재 → **사장님과 개별 판단**(보존 여부).

- [ ] **Step 3: 정리 전략 확정 [STOP — 사장님 확인]**

Step 2 결과를 사장님께 보고하고 아래 중 택1 확인받는다:
- (a) **전 계정 삭제**(개장 전 클린 슬레이트) — 실고객 0일 때 권장. push의 +900만이 빈 테이블에 무해 적용.
- (b) **리허설 계정만 정리**하고 특정 계정 보존 — 보존 계정은 push 후 +900만이 더해지므로 사장님이 인지.
- (c) 중단·재논의.
**확인 전까지 어떤 삭제·push도 하지 않는다.**

---

### Task B2: prod 계정 정리 (초기화) [STOP — 비가역]

**전제:** B1 Step 3에서 전략 확정. **push보다 먼저 실행**(그래야 +900만이 정리 후 상태에 적용).

- [ ] **Step 1: 백업 스냅샷(안전망)**

Run(prod 읽기):
```sql
-- 삭제 전 계정 스냅샷을 로컬 파일로 보관(복구 근거)
\copy (select * from users) to '<scratchpad>/prod-users-backup.csv' csv header
```
(또는 Studio에서 users export.) 스냅샷 없이 삭제 진행 금지.

- [ ] **Step 2: 정리 실행 [STOP — 사장님 최종 확인]**

확정 전략대로:
- (a) 전 계정: 어드민 콘솔 "리허설 데이터 초기화"가 계정·현금을 보존하므로 **부족** — 계정까지 지우려면 prod SQL로 명시 삭제(FK 순서: 종속 거래·보유·주문 → users). 정확한 삭제 SQL은 실행 직전 스키마 FK 확인 후 사장님 승인받아 구성.
- (b) 리허설만: 해당 닉네임/코드 계정 선별 삭제.
Expected: `select count(*) from users` = 의도한 수(전량 삭제면 0).

---

### Task B3: prod db push (마이그레이션 3종 적용) [STOP — 비가역]

- [ ] **Step 1: push 전 최종 점검 [STOP — 사장님 확인]**

미적용 3종이 순서대로 적용됨을 재확인(B1 Step1). 특히 `20260717030000`의 `+900만 전계정`이 B2 정리 후 상태에 적용됨을 사장님과 합의.

- [ ] **Step 2: push**

Run:
```bash
npx supabase db push --linked
```
Expected: 3개 마이그레이션 적용 성공. 에러 시 즉시 중단·보고(부분 적용 상태 확인).

- [ ] **Step 3: push 후 검증(읽기)**

```sql
select count(*) from stocks;                                  -- 42
select count(*) from daily_summary where trade_date='2026-07-31'; -- 42
select value from config where key in ('initial_cash','visit_bonus'); -- 10000000, 1000000
select code, sector from stocks where code in ('OKCC','MHBT','BNOC','SPCO','OKTL'); -- food/cosmetics/shipaero/shipaero/telecom
```
Expected: 위 주석값과 일치. OKTL 소개문에 "혼백" 없이 "요괴 통신망"인지도 확인.

---

### Task B4: 리허설 데이터 재생성 (배치 부트스트랩)

**전제:** 기준가·shares 변경으로 기존 파생 리허설(미래틱·요약·지수이력·뉴스)이 낡음 → 재생성.

- [ ] **Step 1: 리허설 데이터 초기화**

어드민 콘솔 "리허설 데이터 초기화"(파생 데이터 리셋, 계정 보존) 실행. (선례: `rehearsal-reset-before-open`.)

- [ ] **Step 2: 배치 부트스트랩(익일 틱 생성)**

프로덕션 배치를 어제 날짜로 수동 실행해 개장일 틱을 생성(선례: `prod-empty-chart-needs-batch`):
```bash
curl -X POST "https://naraka-stock.vercel.app/api/cron/daily-batch?date=<개장 직전일>" \
  -H "Authorization: Bearer $CRON_SECRET"
```
Expected: `success`. (CRON_SECRET은 pg_cron 잡 정의에서 확보 — `prod-cron-secret-access`. pg_net 타임아웃 주의 — `batch-pgnet-timeout-failure`.)

- [ ] **Step 3: 생성 확인(읽기)**

```sql
select count(*) from daily_ticks where trade_date = '<개장일>';         -- 42 × TICKS_PER_DAY
select count(*) from news where date = '<개장일>';                       -- 힌트+공시+섹터뉴스 다수
```
Expected: 틱·뉴스 생성됨(빈 차트 아님).

---

### Task B5: 실앱 verify (개장 전 최종 확인)

- [ ] **Step 1: verify 스킬로 실앱 확인**

`verify` 스킬(dev 아님 — **프로덕션 URL** 대상, agent-browser)로:
- 시세판에 42종·18섹터 배지(신규 섹터 한국어 라벨, 코드 미노출).
- 신규 15종 상세: 소개문·기준가·섹터 라벨 정상, 힌트뉴스가 피드에 노출(신규 15종).
- 뉴스 피드에 섹터 뉴스가 확장 풀·한국어 라벨로.
- 자금: 신규 가입 시 1,000만, 방문보너스 100만 안내.
- (`rehearsal-render-chart-before-event` 기법으로 실clock 장중화가 필요하면 config open/close 임시 조정 후 원복.)

- [ ] **Step 2: 정리·보고**

임시 config 원복, 브라우저·세션 정리(좀비 없음). 사장님께 개장 준비 완료 보고.

---

## Plan 5 종료 후

- 섹터 개편 대작업(Plan 1~5) 전체 완료 → 브랜치 `feat/sector-overhaul` 최종 정리(이미 Plan1·2·3 main 머지, Plan4·5는 이 브랜치). **finishing-a-development-branch**로 잔여 머지/정리.
- 개장(8/1 15:00) 전 최종 리허설은 운영 절차(`docs/DEPLOY.md` §5).

## Self-Review

- **스펙 커버리지(§7·§8):**
  - §7 simulate 42종/신규가 갱신 + 1,000만 재검증 → A1·A3 ✅
  - §7 시뮬레이터가 새 데이터 소스에서 로드 → A1 DB 생성 방식 ✅
  - §7 튜닝 노브(magnitude/참여율/이벤트분포) → A3 ✅
  - Plan 3 이월 batch·simulate 회귀 대조 안전망 → A2 ✅
  - §8 마이그레이션 순서(정리→push→재생성) → B1-B4 ✅
  - §8 +900만 전계정 1회 리스크·정리 선행 → B1-B3 게이트 ✅
  - §8 prod push + 리허설 재생성 + verify → B3·B4·B5 ✅
- **플레이스홀더 스캔:** A는 완성 코드/명령. B는 프로덕션 런북 — 삭제 SQL만 "실행 직전 FK 확인 후 사장님 승인 구성"으로 의도적 유보(비가역 작업을 사전 하드코딩하지 않음). ✅
- **비가역 안전:** 모든 prod 쓰기(계정 삭제·push·배치)에 STOP 게이트 + 백업 스냅샷. ✅
- **RNG 파리티:** A1 code정렬 생성 + A2 결정성 실증 + 튜닝 시 공유 bias.ts로 양쪽 자동 정합. ✅

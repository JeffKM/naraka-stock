# 10초 틱 실시간 시세 + 견적-잠금 거래 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5분 고정 틱을 10초 틱으로 바꿔 가격이 실제로 자주 움직이게 하고, 화면에서 본 값과 체결값이 정확히 일치(견적-잠금)하도록 만든다.

**Architecture:** `daily_ticks`를 10초 간격(장중 12h = 4,320틱/일)으로 전환해 서버 권위 값을 촘촘하게 만든다. 차트용 5분 OHLC는 `daily_candles`로 분리해 대량행 조회를 피한다. wiggle은 표시용으로 유지(현재 10초 틱값 주위 ±0.1%), 거래는 매수/매도 다이얼로그의 견적-잠금 실틱값으로만 체결한다. 엔진은 이미 `scale = TICKS_PER_DAY/totalTicks`로 σ를 정규화하므로 틱 수만 늘리면 일변동성이 보존된다.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase(Postgres + pg_cron), TanStack Query v5, TailwindCSS v4 + shadcn/ui, 밸런스 검증은 `npm run simulate`(tsx), UI 검증은 verify 스킬(dev 서버 + agent-browser).

## Global Constraints

- 모든 돈 계산은 서버 단일 트랜잭션. 클라이언트가 보낸 가격·잔고는 절대 신뢰하지 않는다.
- 가격은 사전 생성 경로(배치가 익일 전 틱 생성). 장중에는 읽기만.
- 자산은 정수(원). 부동소수 금지(랜덤워크 내부 계산만 float, 저장·체결은 반올림 정수).
- TypeScript strict — `any` 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트, 개별 임포트, 경로 alias `@/*`.
- 커밋: `type: 한국어 설명` (feat/fix/refactor/docs/chore). 커밋 메시지 끝에 Co-Authored-By 트레일러.
- 작업 브랜치: `feat/10s-tick-live-pricing` (이미 생성됨, main 직접 수정 금지).
- 매 Task 종료 시 `npm run build` + `npx eslint src` 통과 확인.
- UI 문구에 이모지 금지.

## 파일 구조 (생성/수정 대상)

**설정·엔진 (TS)**
- `src/lib/market.ts` — 틱 간격을 초 단위로 전환(`TICK_INTERVAL_SECONDS`), `getKstParts`에 second 추가, `getTickIndex`/`ticksPerDay`/`tickTimestamp` 초 기반화, 5분 버킷 헬퍼 추가.
- `src/lib/engine/randomWalk.ts` — 변경 최소(틱 수 스케일 자동). 반올림 드리프트 방지 확인만.

**DB (SQL 마이그레이션, 신규 파일)**
- `supabase/migrations/20260719100000_tick_10s.sql` — `daily_ticks` CHECK 상한 확대, 현재 틱 산출을 초 기반으로(체결 RPC·현재가 계산), `daily_candles` 테이블 + 집계.
- `supabase/migrations/20260719110000_candles_and_batch.sql` — 배치 RPC가 캔들 집계·삽입, 종가/밴드 "MAX(tick_index)" 일반화, 프루닝 함수.

**서비스·API (TS)**
- `src/services/batchService.ts` — `ticksPerDay` 초 기반, 캔들 생성 호출.
- `src/services/quoteService.ts` — 초 기반 tick_index(변경 대부분 market.ts 위임), asOf 유지.
- `src/services/chartService.ts` — 소스를 `daily_candles`로.
- `src/app/api/quotes/route.ts` + 신규 `src/app/api/price/route.ts` — 경량 현재가 + 엣지 캐시.

**클라이언트 (TS/TSX)**
- `src/hooks/useQuotes.ts` — 10초 경계 폴링, 백그라운드 정지.
- `src/hooks/usePriceWiggle.ts` — 유지(base에 10초 틱값 주입, 재앵커).
- `src/hooks/usePriceFlash.ts` — 진짜 10초 틱 변화에 발동(연동 확인).
- `src/components/trade/TradePanel.tsx` — 견적-잠금 UI.
- `src/components/chart/StockChart.tsx` — 5분 캔들스틱.

---

## Phase 1 — 틱 간격 초 기반화 (설정·유틸)

### Task 1: `getKstParts`에 second 추가

**Files:**
- Modify: `src/lib/market.ts:34-58` (`KstParts` 인터페이스 + `getKstParts`)

**Interfaces:**
- Produces: `getKstParts(now?).second: number` (0~59)

- [ ] **Step 1: `KstParts`에 second 필드 추가**

`src/lib/market.ts`의 `interface KstParts`에 필드 추가:

```ts
interface KstParts {
  date: string; // YYYY-MM-DD
  isoWeekday: number; // 1(월) ~ 7(일)
  hour: number;
  minute: number;
  second: number;
}
```

- [ ] **Step 2: `getKstParts`가 초를 추출하도록 수정**

`Intl.DateTimeFormat` 옵션에 `second: "2-digit"` 추가하고 반환 객체에 `second` 추가:

```ts
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
```

반환부:

```ts
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    isoWeekday: weekdayMap[parts.weekday],
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
```

- [ ] **Step 3: 타입·빌드 확인**

Run: `npx eslint src/lib/market.ts && npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/lib/market.ts
git commit -m "feat: getKstParts에 초 단위 추가 (10초 틱 준비)"
```

### Task 2: 틱 간격 상수·헬퍼 초 기반 전환

**Files:**
- Modify: `src/lib/market.ts:14` (상수), `:69-71` (`ticksPerDay`), `:92-105` (`getTickIndex`), `:107-111` (`tickTimestamp`)

**Interfaces:**
- Produces:
  - `TICK_INTERVAL_SECONDS = 10`
  - `TICK_INTERVAL_MINUTES` (기존 유지, 파생: `TICK_INTERVAL_SECONDS/60` 아님 — 캔들 5분 상수는 별도)
  - `CANDLE_INTERVAL_MINUTES = 5`, `TICKS_PER_CANDLE = CANDLE_INTERVAL_MINUTES*60 / TICK_INTERVAL_SECONDS` (= 30)
  - `ticksPerDay(hours)` → 초 기반 총 틱 수
  - `getTickIndex(now, hours, rules)` → 초 기반 인덱스
  - `bucketOfTick(tickIndex): number` → 5분 버킷 인덱스
  - `tickTimestamp(date, tickIndex, openHour)` → 10초 간격 시각

- [ ] **Step 1: 상수 교체**

`TICK_INTERVAL_MINUTES = 5` 라인을 아래로 교체(엔진 baseline `TICKS_PER_DAY=84`는 그대로 둔다):

```ts
// 운영 틱 간격(초). 10초 = 실시간 시세. 폴백 시 이 값만 바꿔 재배포하면 된다.
export const TICK_INTERVAL_SECONDS = 10;
// 차트 캔들 간격(분)과 캔들당 틱 수
export const CANDLE_INTERVAL_MINUTES = 5;
export const TICKS_PER_CANDLE = (CANDLE_INTERVAL_MINUTES * 60) / TICK_INTERVAL_SECONDS; // 30
```

`TICK_INTERVAL_MINUTES` 상수를 참조하는 다른 곳이 있으면 전부 위 상수 기반으로 바꾼다. 확인:

Run: `rg -n "TICK_INTERVAL_MINUTES" src/`
남는 참조를 아래 Step들에서 제거한다.

- [ ] **Step 2: `ticksPerDay` 초 기반화**

```ts
// 장 시간 기준 하루 틱 수 (12~24시, 10초 간격이면 4,320틱)
export function ticksPerDay(hours: MarketHours = DEFAULT_MARKET_HOURS): number {
  return ((hours.closeHour - hours.openHour) * 3600) / TICK_INTERVAL_SECONDS;
}
```

- [ ] **Step 3: `getTickIndex` 초 기반화**

```ts
// 현재 시각의 틱 인덱스 (0 ~ ticksPerDay-1). 장외 시간이면 null.
export function getTickIndex(
  now: Date = new Date(),
  hours: MarketHours = DEFAULT_MARKET_HOURS,
  rules: OpenDayRules = {}
): number | null {
  if (getMarketState(now, hours, rules) !== "open") return null;
  const { hour, minute, second } = getKstParts(now);
  const secondsSinceOpen = (hour - hours.openHour) * 3600 + minute * 60 + second;
  return Math.min(
    Math.floor(secondsSinceOpen / TICK_INTERVAL_SECONDS),
    ticksPerDay(hours) - 1
  );
}
```

- [ ] **Step 4: `tickTimestamp` 초 기반화 + 버킷 헬퍼 추가**

```ts
// 게임 날짜 + 틱 인덱스 → 실제 순간(UTC ISO). 개장 시각 기준 10초 간격.
export function tickTimestamp(date: string, tickIndex: number, openHour: number): string {
  const open = String(openHour).padStart(2, "0");
  const base = new Date(`${date}T${open}:00:00+09:00`).getTime();
  return new Date(base + tickIndex * TICK_INTERVAL_SECONDS * 1000).toISOString();
}

// 틱 인덱스 → 5분 캔들 버킷 인덱스
export function bucketOfTick(tickIndex: number): number {
  return Math.floor(tickIndex / TICKS_PER_CANDLE);
}
```

- [ ] **Step 5: 남은 `TICK_INTERVAL_MINUTES` 참조 정리**

Run: `rg -n "TICK_INTERVAL_MINUTES" src/`
Expected: 결과 없음 (모두 초 기반으로 대체됨). 남아 있으면 해당 사용처를 `TICK_INTERVAL_SECONDS`/`CANDLE_INTERVAL_MINUTES` 기준으로 수정.

- [ ] **Step 6: 빌드·린트 확인**

Run: `npm run build && npx eslint src`
Expected: 통과

- [ ] **Step 7: 커밋**

```bash
git add src/lib/market.ts
git commit -m "feat: 틱 간격을 10초 기반으로 전환 (ticksPerDay/getTickIndex/tickTimestamp)"
```

### Task 3: 밸런스 재시뮬 (10초 틱 일변동성 보존 확인)

**Files:**
- 없음(검증 전용). 필요 시 `src/lib/engine/randomWalk.ts:116-119`(`roundPrice`) 조정.

- [ ] **Step 1: 시뮬 실행 (기준선 대비 일변동성)**

Run: `npm run simulate -- --runs 500`
확인: 종목 등급별 일변동성·중앙값 드리프트·상하한 도달 빈도가 5분 틱 시절과 동등한 범위인지. 엔진의 `scale = TICKS_PER_DAY/totalTicks` 정규화 덕에 큰 편차가 없어야 정상.

- [ ] **Step 2: 반올림 드리프트 점검**

`randomWalk.ts`의 루프는 `price`(float)로 진행하고 `roundPrice`는 표시·저장용으로만 쓰이는지 확인(`prices[i-1]`이 rounded 값을 쓰면 4,320회 누적 드리프트 발생 가능). 현재 `const prev = i===0 ? prevClose : prices[i-1]`은 volume 계산용이고, 다음 스텝 `price *= exp(...)`는 float `price`를 이어가므로 드리프트 안전. **만약** 시뮬에서 계통적 상방/하방 드리프트가 관측되면, VI/밴드 판정에 쓰는 `prices[i-1]`을 float 원값 배열로 분리한다.

- [ ] **Step 3: 결과 기록·커밋(문서만)**

시뮬 요약을 `docs/superpowers/specs/2026-07-19-10s-tick-live-pricing-design.md` 하단 "밸런스 검증" 절에 추가.

```bash
git add docs/superpowers/specs/2026-07-19-10s-tick-live-pricing-design.md
git commit -m "docs: 10초 틱 밸런스 재시뮬 결과 기록"
```

---

## Phase 2 — DB: 10초 틱 스키마 + 현재 틱 산출

### Task 4: `daily_ticks` CHECK 확대 + 현재 틱 초 기반 산출

**Files:**
- Create: `supabase/migrations/20260719100000_tick_10s.sql`
- 참조(수정 대상 함수 원본): `supabase/migrations/20260714040000_fractional_shares.sql`, `20260716040000_buy_quantity.sql`, `20260714030000_market_hours_fallback_align.sql` — 현재 틱 계산 `v_tick := floor(((extract(hour ...) - open)*60 + extract(minute ...))/5)` 패턴이 있는 최신 함수들.

**Interfaces:**
- Produces: 체결·주문 RPC들이 초 기반 `v_tick`을 산출. `daily_ticks.tick_index` 상한 = 장 시간에서 파생(최대 4,320-1).

- [ ] **Step 1: 최신 함수 본문 확인**

Run: `rg -n "v_tick :=|extract(minute|/ 5\b|tick_index between" supabase/migrations/`
현재 유효한(가장 나중 정의된) 체결/주문 함수의 `v_tick` 산출식을 찾는다. 대상: `execute_trade`, 지정가 관련 `place_limit_order`/`try_fill_orders` 등 `v_tick`을 쓰는 모든 함수.

- [ ] **Step 2: 마이그레이션 작성 — CHECK 제약 완화**

`daily_ticks`의 `tick_index` 상한은 장 시간 config에 따라 가변이므로, 고정 상한 CHECK를 제거하고 하한만 유지한다:

```sql
-- 10초 틱 전환: tick_index 상한을 장 시간 파생값으로 (고정 CHECK 제거)
alter table daily_ticks drop constraint if exists daily_ticks_tick_index_check;
alter table daily_ticks add constraint daily_ticks_tick_index_nonneg check (tick_index >= 0);
-- smallint(최대 32767) > 4,320이라 타입 변경 불필요
```

- [ ] **Step 3: 현재 틱 산출식을 초 기반으로 교체 (모든 관련 함수 재정의)**

Step 1에서 찾은 각 함수를 `create or replace function`으로 재정의하되, `v_tick` 산출 라인만 아래로 교체(나머지 본문은 현재 정의를 그대로 복사):

```sql
-- 기존: v_tick := floor(((extract(hour from v_kst) - v_open) * 60 + extract(minute from v_kst)) / 5);
-- 신규(10초):
v_tick := floor((
  (extract(hour from v_kst) - v_open) * 3600
  + extract(minute from v_kst) * 60
  + extract(second from v_kst)
) / 10);
```

장 시간 상한 클램프가 있으면 그 상한도 초 기반 `ticks_per_day - 1`로 맞춘다(`(close_hour - open_hour)*3600/10 - 1`).

주의: 하드코딩된 `/ 5`, `* 60`(분 환산), `43`/`143`/`83` 같은 상한 리터럴을 전부 초 기반으로. `rg -n "/ 5\b|>= 22|< 15|143|83" supabase/migrations/`로 잔재 확인.

- [ ] **Step 4: 로컬 리셋으로 적용 확인**

Run: `npx supabase db reset`
Expected: 마이그레이션 에러 없이 적용. 함수 재정의 성공.

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/20260719100000_tick_10s.sql
git commit -m "feat: daily_ticks 10초 틱 전환 (CHECK 완화 + 현재 틱 초 기반 산출)"
```

### Task 5: `daily_candles` 테이블 + 집계 함수

**Files:**
- Modify: `supabase/migrations/20260719100000_tick_10s.sql` (같은 마이그레이션에 이어서)

**Interfaces:**
- Produces:
  - 테이블 `daily_candles(stock_code, date, bucket, open, high, low, close, volume)`
  - 함수 `build_daily_candles(p_stock_code text, p_date date)` — 해당 종목·날짜의 `daily_ticks`를 5분 버킷으로 집계해 upsert.

- [ ] **Step 1: 테이블 생성**

```sql
create table if not exists daily_candles (
  stock_code text not null references stocks (code),
  date date not null,
  bucket smallint not null,          -- 5분 버킷 (0 ~ 143)
  open bigint not null check (open > 0),
  high bigint not null check (high > 0),
  low bigint not null check (low > 0),
  close bigint not null check (close > 0),
  volume bigint not null default 0,
  primary key (stock_code, date, bucket)
);
create index if not exists daily_candles_date_bucket_idx on daily_candles (date, bucket);
```

- [ ] **Step 2: 집계 함수 작성 (버킷 = 30틱)**

```sql
-- 10초 틱 30개(5분)를 OHLC로 집계해 daily_candles에 upsert
create or replace function build_daily_candles(p_stock_code text, p_date date)
returns void
language sql
as $$
  insert into daily_candles (stock_code, date, bucket, open, high, low, close, volume)
  select
    p_stock_code,
    p_date,
    (tick_index / 30)::smallint as bucket,
    (array_agg(price order by tick_index))[1]                       as open,
    max(price)                                                      as high,
    min(price)                                                      as low,
    (array_agg(price order by tick_index desc))[1]                  as close,
    coalesce(sum(volume), 0)                                        as volume
  from daily_ticks
  where stock_code = p_stock_code and date = p_date
  group by (tick_index / 30)
  on conflict (stock_code, date, bucket) do update
    set open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, volume = excluded.volume;
$$;
```

(주: `30` = `TICKS_PER_CANDLE`. 장 시간이 config로 바뀌어도 5분=30틱 관계는 불변.)

- [ ] **Step 3: 적용·수동 검증**

Run: `npx supabase db reset`
그다음 SQL로 배치 부트스트랩 후 집계 검증(리허설 데이터가 있으면):

```sql
select build_daily_candles('DUMMY', current_date);
select bucket, open, high, low, close, volume from daily_candles
  where stock_code = 'DUMMY' and date = current_date order by bucket limit 5;
```

Expected: 버킷별 OHLC 행. high >= max(open,close) >= low.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260719100000_tick_10s.sql
git commit -m "feat: daily_candles 5분 OHLC 테이블 + 집계 함수"
```

---

## Phase 3 — 배치: 10초 틱 생성 + 캔들 집계 + 종가/밴드 일반화

### Task 6: 배치 서비스 초 기반 틱 수 + 캔들 집계 호출

**Files:**
- Modify: `src/services/batchService.ts:77`(`ticksPerDay` 호출은 이미 함수 사용 → 자동), `:236`(`config.ticksPerDay - 1` 종가 인덱스), `:240`(`apply_daily_batch` 호출 이후)

**Interfaces:**
- Consumes: `ticksPerDay(hours)`(Task 2, 초 기반), `apply_daily_batch` RPC
- Produces: 배치가 각 종목 생성 후 `build_daily_candles` 호출(또는 배치 RPC 내부에서 일괄 집계 — Step 2 선택)

- [ ] **Step 1: 틱 수 파생 확인**

`batchService.ts`의 `config.ticksPerDay = ticksPerDay({openHour, closeHour})`는 Task 2에서 초 기반이 됐으므로 12~24시면 4,320이 된다. `generateDailyPath(..., config.ticksPerDay)`가 4,320틱을 만든다. 코드 변경 없음(값만 커짐). 확인:

Run: `rg -n "ticksPerDay|generateDailyPath|disclosureAt|ticks_per_day" src/services/batchService.ts`

- [ ] **Step 2: 캔들 집계 트리거 추가**

`apply_daily_batch` RPC 성공 직후(대량 틱 삽입 완료 후), 종목별로 캔들을 집계한다. 배치 RPC 내부에서 하는 게 왕복을 줄인다 — `apply_daily_batch` 정의(마이그레이션)에 각 종목 틱 upsert 뒤 `perform build_daily_candles(stock_code, p_date)` 호출을 추가한다. 배치 RPC를 수정하는 마이그레이션은 Task 7에서 함께.

임시로 서비스 레벨에서 하려면 `apply_daily_batch` 응답 후:

```ts
// 캔들 집계 (차트 소스). 배치 RPC가 내부 집계하면 이 블록 제거.
for (const stockCode of generatedStockCodes) {
  await supabase.rpc("build_daily_candles", { p_stock_code: stockCode, p_date: today });
}
```

**결정:** 배치 RPC 내부 집계를 선호(Task 7). 서비스 루프는 폴백.

- [ ] **Step 3: 빌드·린트**

Run: `npm run build && npx eslint src`
Expected: 통과

- [ ] **Step 4: 커밋**

```bash
git add src/services/batchService.ts
git commit -m "feat: 배치 10초 틱 생성 + 캔들 집계 연동"
```

### Task 7: 배치 RPC 내부 캔들 집계 + 종가/밴드 MAX(tick_index) 일반화

**Files:**
- Create: `supabase/migrations/20260719110000_candles_and_batch.sql`
- 참조: `apply_daily_batch` 최신 정의(위치는 `rg -ln "function apply_daily_batch" supabase/migrations/`), `daily_summary` 종가 기록·밴드 산출부.

**Interfaces:**
- Produces: `apply_daily_batch`가 종목 틱 삽입 후 `build_daily_candles` 호출. 종가/밴드가 `MAX(tick_index)` 기반.

- [ ] **Step 1: 최신 `apply_daily_batch` 본문 확인**

Run: `rg -n "function apply_daily_batch|tick_index = 143|tick_index = 83|order by tick_index desc|prev_close|close" supabase/migrations/`
종가를 "마지막 틱"으로 잡는 부분을 찾는다(고정 인덱스면 문제, `MAX`/`order desc limit 1`이면 OK).

- [ ] **Step 2: 마이그레이션 — 종가 산출 일반화**

종가·직전종가를 고정 인덱스(143/83)로 읽는 곳이 있으면 아래로 교체:

```sql
-- 종가 = 그날 마지막 틱 (틱 수 가변 대응)
select price into v_close
  from daily_ticks
  where stock_code = p_stock_code and date = p_date
  order by tick_index desc
  limit 1;
```

- [ ] **Step 3: `apply_daily_batch`에 캔들 집계 추가**

`create or replace function apply_daily_batch(...)` 재정의에서, 종목별 틱 삽입 루프/구문 뒤에 추가:

```sql
  perform build_daily_candles(v_stock_code, p_date);
```

(종목 코드 변수명은 현재 함수의 것에 맞춘다.)

- [ ] **Step 4: 적용·검증**

Run: `npx supabase db reset`
그다음 배치 수동 실행으로 캔들이 채워지는지:

```bash
curl -X POST "localhost:3000/api/cron/daily-batch?date=$(date -v-1d +%F)" -H "Authorization: Bearer $CRON_SECRET"
```

SQL 확인:

```sql
select count(*) from daily_candles where date = current_date; -- 42종목 × ~144 버킷
select count(*) from daily_ticks where date = current_date;   -- 42종목 × ~4320
```

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/20260719110000_candles_and_batch.sql
git commit -m "feat: 배치 RPC 캔들 집계 + 종가 MAX(tick_index) 일반화"
```

---

## Phase 4 — API: 현재가 폴링 + 엣지 캐시 + 차트 소스

### Task 8: 경량 현재가 엔드포인트 + 엣지 캐시

**Files:**
- Create: `src/app/api/price/route.ts`
- 참조: `src/services/quoteService.ts`(현재가 산출 재사용)

**Interfaces:**
- Produces: `GET /api/price` → `{ asOf: string, prices: Array<{ code: string, price: number, isHalted: boolean }> }`, 응답 헤더 `Cache-Control: public, s-maxage=10, stale-while-revalidate=5`.

- [ ] **Step 1: 서비스에 경량 현재가 함수 추가**

`quoteService.ts`에 전 종목 현재가만 반환하는 함수 추가(기존 `getQuoteBoard`의 틱 산출 로직 재사용, 밴드·지수·등락 계산 제외):

```ts
export interface PriceTick { code: string; price: number; isHalted: boolean; }
export interface PriceBoard { asOf: string; prices: PriceTick[]; }

export async function getPriceBoard(): Promise<PriceBoard> {
  // getQuoteBoard와 동일한 현재 tick_index·fallback 경로를 재사용하되
  // 반환은 code/price/isHalted만. (내부 헬퍼로 공통화 권장)
}
```

- [ ] **Step 2: 라우트 작성 (엣지 캐시 헤더)**

```ts
import { NextResponse } from "next/server";
import { getPriceBoard } from "@/services/quoteService";
import { handleApiError } from "@/lib/api/response";

// 10초 틱 현재가 전용 경량 엔드포인트. 엣지 캐시로 오리진 계산을 10초당 1회로 공유.
export async function GET() {
  try {
    const board = await getPriceBoard();
    return NextResponse.json(
      { success: true, data: board },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=5" } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 3: 수동 검증**

Run: `npm run dev` 후 `curl -i localhost:3000/api/price`
Expected: 200, `Cache-Control: public, s-maxage=10...` 헤더, `prices` 배열 42종목.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/price/route.ts src/services/quoteService.ts
git commit -m "feat: 10초 현재가 경량 엔드포인트 + 엣지 캐시"
```

### Task 9: 차트 소스를 `daily_candles`로 전환

**Files:**
- Modify: `src/services/chartService.ts` (틱 조회 → 캔들 조회)

**Interfaces:**
- Consumes: `daily_candles`
- Produces: 차트 API가 5분 OHLC 배열 반환 `{ bucket, open, high, low, close, volume, t }`.

- [ ] **Step 1: 캔들 조회로 교체**

`chartService.ts`에서 `daily_ticks` 조회를 `daily_candles`로 바꾼다. 캔들은 종목·날짜당 ~144행이라 1,000행 페이지네이션 불필요(멀티데이 범위는 Task 15에서 일봉 처리).

```ts
const { data } = await supabase
  .from("daily_candles")
  .select("bucket, open, high, low, close, volume")
  .eq("stock_code", code)
  .eq("date", date)
  .order("bucket", { ascending: true });
```

시간축(`t`)은 `tickTimestamp(date, bucket * TICKS_PER_CANDLE, openHour)` 로 버킷 시작 시각 산출.

- [ ] **Step 2: 빌드·린트**

Run: `npm run build && npx eslint src`

- [ ] **Step 3: 커밋**

```bash
git add src/services/chartService.ts
git commit -m "feat: 차트 소스를 daily_candles 5분 캔들로 전환"
```

---

## Phase 5 — 클라이언트: 폴링·플래시·wiggle

### Task 10: 10초 경계 폴링 + 백그라운드 정지

**Files:**
- Modify: `src/hooks/useQuotes.ts`

**Interfaces:**
- Consumes: `TICK_INTERVAL_SECONDS`
- Produces: `useQuotes()`가 10초 경계 정렬 폴링, 탭 숨김 시 폴링 중단.

- [ ] **Step 1: 폴링 주기를 10초 경계로**

`msUntilNextTick`을 초 기반으로:

```ts
import { TICK_INTERVAL_SECONDS } from "@/lib/market";

function msUntilNextTick(): number {
  const interval = TICK_INTERVAL_SECONDS * 1000;
  return interval - (Date.now() % interval) + 500; // 서버 반영 여유 0.5초
}
```

`useQuery` 옵션에 백그라운드 정지 추가:

```ts
  return useQuery({
    queryKey: ["quotes"],
    queryFn: () => getJson<QuoteBoardDto>("/api/quotes"),
    refetchInterval: msUntilNextTick,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
```

- [ ] **Step 2: 빌드·린트**

Run: `npm run build && npx eslint src`

- [ ] **Step 3: 커밋**

```bash
git add src/hooks/useQuotes.ts
git commit -m "feat: 시세 폴링 10초 경계 정렬 + 백그라운드 정지"
```

### Task 11: wiggle 재앵커 + 플래시 10초 연동 확인

**Files:**
- Modify(필요 시): `src/hooks/usePriceWiggle.ts`, `src/app/stocks/[code]/page.tsx:51-56`

**Interfaces:**
- Consumes: `usePriceWiggle(price, enabled)` (기존)

- [ ] **Step 1: wiggle 유지 확인 (코드 변경 최소)**

`usePriceWiggle`은 `base`(=현재 10초 틱값)가 바뀌면 자동 재앵커한다(`wiggle.base === base` 무효화). 10초마다 `quote.price`가 갱신되면 wiggle이 새 값 주위로 재조정된다 → 코드 변경 불필요. 진폭 ±0.1%(`0.002`) 유지.

- [ ] **Step 2: 플래시가 진짜 틱 변화에 발동하도록 확인**

상세 페이지에서 `usePriceFlash(displayPrice)`는 wiggle값 변화(2.5초)에도 반응한다. **진짜 10초 틱 변화에만** 플래시하려면 `usePriceFlash(quote.price)`(원값)로 바꾼다:

```ts
// 플래시는 진짜 10초 틱 변화에만 (wiggle 잔진동엔 반응하지 않음)
const flash = usePriceFlash(quote?.price ?? 0);
```

`page.tsx:56`의 `usePriceFlash(displayPrice)` → `usePriceFlash(quote?.price ?? 0)`.

- [ ] **Step 3: 시세판(`page.tsx:76`)도 동일 원칙 확인**

홈 시세판은 `usePriceWiggle(q.price, ...)`로 표시하되 플래시는 `q.price` 기준인지 확인. 아니면 동일 수정.

- [ ] **Step 4: UI 검증 (verify 스킬)**

verify 스킬로 dev + agent-browser 구동, 리허설 장중 상태에서 상세 페이지 가격이 wiggle로 살아있고 10초마다 플래시가 터지는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/app/stocks/[code]/page.tsx src/app/page.tsx
git commit -m "feat: 플래시를 진짜 10초 틱 변화 기준으로 (wiggle 잔진동과 분리)"
```

---

## Phase 6 — 견적-잠금 거래 UI

### Task 12: 견적-잠금 상태 훅

**Files:**
- Create: `src/hooks/useQuoteLock.ts`

**Interfaces:**
- Produces:
  - `useQuoteLock(currentPrice: number, side: "buy" | "sell"): { lockedPrice: number; moved: "none" | "favorable" | "adverse"; relock: () => void }`
  - 규칙: 다이얼로그 오픈 시 `lockedPrice = currentPrice` 캡처. 이후 `currentPrice`가 바뀌면:
    - 매수 하락 / 매도 상승 = **favorable** → 자동으로 `lockedPrice` 갱신, `moved="favorable"`(짧게 표시 후 none).
    - 매수 상승 / 매도 하락 = **adverse** → `lockedPrice` 유지, `moved="adverse"` (사용자 재확인 필요).
  - `relock()` = 현재가로 다시 잠금(사용자가 "다시 확인" 누를 때).

- [ ] **Step 1: 훅 작성**

```ts
"use client";

import { useEffect, useRef, useState } from "react";

type Moved = "none" | "favorable" | "adverse";

// 견적-잠금: 다이얼로그 열 때 현재 틱값을 잠그고, 이후 변동을 유·불리로 판정.
// 유리하면 자동 반영, 불리하면 잠금 유지 + 재확인 요구.
export function useQuoteLock(currentPrice: number, side: "buy" | "sell") {
  const [lockedPrice, setLockedPrice] = useState(currentPrice);
  const [moved, setMoved] = useState<Moved>("none");
  const initial = useRef(false);

  // 최초 마운트 시 현재가로 잠금
  if (!initial.current && currentPrice > 0) {
    initial.current = true;
  }

  useEffect(() => {
    if (currentPrice <= 0 || lockedPrice <= 0) return;
    if (currentPrice === lockedPrice) return;
    const favorable = side === "buy" ? currentPrice < lockedPrice : currentPrice > lockedPrice;
    if (favorable) {
      setLockedPrice(currentPrice); // 유리 → 자동 반영
      setMoved("favorable");
    } else {
      setMoved("adverse"); // 불리 → 잠금 유지, 재확인
    }
  }, [currentPrice, lockedPrice, side]);

  function relock() {
    setLockedPrice(currentPrice);
    setMoved("none");
  }

  return { lockedPrice, moved, relock };
}
```

- [ ] **Step 2: 빌드·린트**

Run: `npx eslint src/hooks/useQuoteLock.ts && npx tsc --noEmit`

- [ ] **Step 3: 커밋**

```bash
git add src/hooks/useQuoteLock.ts
git commit -m "feat: 견적-잠금 훅 (유리 자동반영·불리 재확인)"
```

### Task 13: 매수/매도 다이얼로그에 견적-잠금 적용

**Files:**
- Modify: `src/components/trade/TradePanel.tsx` (`BuyDialog`, `SellDialog`)

**Interfaces:**
- Consumes: `useQuoteLock`, `quote.price`(실틱값, wiggle 아님)

- [ ] **Step 1: 다이얼로그에 잠금 견적 표시**

`BuyDialog`/`SellDialog` 상단(`DialogDescription` 아래)에 실틱값 기반 견적 배지 추가. 예상 수량·금액 계산의 `quote.price`를 `lockedPrice`로 교체(체결 기준을 잠금값과 일치시켜 사용자가 본 값 = 주문 값).

```tsx
const { lockedPrice, moved, relock } = useQuoteLock(quote.price, "buy");
// ...
<div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
  <span className="text-muted-foreground">현재가</span>
  <span className="font-semibold tabular-nums">{formatMoney(lockedPrice)}</span>
</div>
{moved === "adverse" && (
  <p className="text-xs text-bear">
    가격이 바뀌었어요 · 다시 확인해 주세요
  </p>
)}
```

`unit`/`quantity`/`buyAmount` 계산에서 `quote.price` → `lockedPrice`로 교체(시장가 경로만; 지정가는 `limitPrice` 유지).

- [ ] **Step 2: 불리 변동 시 확정 버튼 게이팅**

`moved === "adverse"`면 확정 버튼을 "다시 확인"으로 바꾸고, 누르면 `relock()`만 수행(주문 미제출):

```tsx
<Button
  className="h-12 bg-bull text-base font-bold text-white hover:bg-bull/90"
  disabled={!valid || submitting}
  onClick={moved === "adverse" ? relock : onSubmit}
>
  {moved === "adverse" ? "가격 변동 · 다시 확인" : /* 기존 라벨 */}
</Button>
```

`SellDialog`도 동일하게 `side="sell"`로 적용.

- [ ] **Step 3: 서버 체결 정합성 확인**

체결은 서버가 주문 시점 틱값으로 실행하므로, 잠금값과 서버 체결값이 다를 수 있는 유일한 경우는 "잠금 후~제출 사이 10초 경계 통과"다. 이땐 서버가 최신 틱으로 체결(정직). UI 잠금은 사용자 인지용. **클라이언트가 가격을 서버로 보내지 않음**을 재확인(`/api/trade` 페이로드에 price 없음 — 현재 구조 유지).

Run: `rg -n "price" src/components/trade/TradePanel.tsx` 로 전송 페이로드에 price가 없는지 확인.

- [ ] **Step 4: UI 검증 (verify 스킬)**

리허설 장중에서 다이얼로그 열고 10초 경계에서 견적이 유리 시 자동 갱신, 불리 시 "다시 확인"으로 바뀌는지 확인. 실제 매수 후 체결가 = 표시 견적(경계 미통과 시) 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/components/trade/TradePanel.tsx
git commit -m "feat: 매수·매도 다이얼로그 견적-잠금 (슬리피지 인지·재확인)"
```

---

## Phase 7 — 캔들차트 + 운영 마무리

### Task 14: 5분 캔들스틱 차트

**Files:**
- Modify: `src/components/chart/StockChart.tsx`

**Interfaces:**
- Consumes: 차트 API(Task 9, OHLC 배열)

- [ ] **Step 1: 캔들스틱 렌더 추가**

`StockChart.tsx`에 캔들 모드 추가(기존 라인 유지 + 토글, 또는 캔들 기본). recharts 사용 중이면 `Bar`(고저 심지) + 커스텀 캔들 shape, 또는 종가 라인 위에 OHLC 표기. 데이터는 Task 9의 `{bucket, open, high, low, close}` 사용. 등락 색은 `close >= open`이면 bull, 아니면 bear.

- [ ] **Step 2: UI 검증**

verify 스킬로 상세 페이지 차트가 5분 캔들로 렌더되고, 당일 데이터가 버킷 시각축에 정렬되는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add src/components/chart/StockChart.tsx
git commit -m "feat: 5분 OHLC 캔들스틱 차트"
```

### Task 15: 장기(멀티데이) 차트 일봉 처리

**Files:**
- Modify: `src/services/chartService.ts`

**Interfaces:**
- Produces: 범위가 여러 날이면 `daily_summary`(일봉) 소스, 당일은 `daily_candles`(5분봉).

- [ ] **Step 1: 범위별 소스 분기**

멀티데이 뷰(예: 최근 N일)는 `daily_summary`의 일별 종가/OHLC를 쓰고, 당일 인트라데이만 `daily_candles`. `daily_candles` 30일치(4,320행)를 한 번에 긁지 않도록.

- [ ] **Step 2: 빌드·검증·커밋**

```bash
git add src/services/chartService.ts
git commit -m "feat: 멀티데이 차트 일봉 소스 분기 (캔들 대량조회 회피)"
```

### Task 16: raw 10초틱 프루닝 함수

**Files:**
- Modify: `supabase/migrations/20260719110000_candles_and_batch.sql`

**Interfaces:**
- Produces: `prune_old_ticks(p_keep_days int)` — 캔들 집계 완료된, `p_keep_days`보다 오래된 raw `daily_ticks` 삭제. 배치 말미에서 호출.

- [ ] **Step 1: 프루닝 함수 작성**

```sql
-- 캔들 집계 후 오래된 raw 10초틱 삭제(캔들·일봉은 영구 보관)
create or replace function prune_old_ticks(p_keep_days int default 3)
returns void
language sql
as $$
  delete from daily_ticks
  where date < (current_date - p_keep_days);
$$;
```

- [ ] **Step 2: 배치에서 호출**

`apply_daily_batch` 말미 또는 `batchService` 배치 완료 후 `supabase.rpc("prune_old_ticks", { p_keep_days: 3 })` 호출 추가.

- [ ] **Step 3: 검증·커밋**

Run: `npx supabase db reset` 후 함수 존재 확인.

```bash
git add supabase/migrations/20260719110000_candles_and_batch.sql src/services/batchService.ts
git commit -m "feat: raw 10초틱 프루닝 (캔들 집계 후 오래된 틱 정리)"
```

### Task 17: 리셋/리허설 함수 10초 대응 + config 폴백 확인

**Files:**
- 참조: `supabase/migrations/20260713050000_reset_function.sql`, `20260717040000_reset_fk_fix.sql`, `20260713020000_price_reset.sql` 등 리셋·리허설·시세조정 함수.

**Interfaces:**
- Produces: 리셋/리허설/시세조정 경로가 4,320틱·캔들·프루닝과 정합. `TICK_INTERVAL_SECONDS` 변경만으로 폴백 가능함을 확인.

- [ ] **Step 1: 리셋·시세조정 함수의 틱 인덱스 가정 점검**

Run: `rg -n "tick_index|/ 5\b|143|83|regenerate|reset_rehearsal|replace_future" supabase/migrations/2026071305*.sql supabase/migrations/2026071704*.sql`
고정 틱 상한·5분 가정이 있으면 초 기반/`MAX`로 일반화하는 마이그레이션 추가(`20260719120000_reset_10s.sql`).

- [ ] **Step 2: 리허설 재생성 후 캔들도 갱신되는지 확인**

시세조정/리허설 재생성 경로가 `daily_ticks`를 바꾸면 `build_daily_candles`도 재호출되도록 연결.

- [ ] **Step 3: 폴백 리허설**

`TICK_INTERVAL_SECONDS`를 임시로 큰 값으로 바꿔 재배포 없이(로컬) 틱 수가 줄어드는지 확인 → 폴백 경로 검증. 확인 후 10으로 복귀.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "feat: 리셋·리허설·시세조정 경로 10초 틱 정합"
```

---

## Phase 8 — 통합 검증

### Task 18: 리허설 전체 시나리오 검증

**Files:** 없음(검증 전용). 참조: `docs/DEPLOY.md`, verify 스킬, 리허설 초기화 콘솔.

- [ ] **Step 1: 리허설 장중 부트스트랩**

리허설 초기화 → 어제 날짜 배치(`?date=어제`)로 오늘 틱 부트스트랩 → config로 실clock 장중화(기존 리허설 기법). `daily_ticks` 4,320행/종목, `daily_candles` 채워짐 확인.

- [ ] **Step 2: 실앱 4대 흐름 검증 (verify 스킬)**

1. 상세 페이지: 가격 wiggle 생동감 + 10초마다 플래시.
2. 매수: 다이얼로그 견적-잠금값 = 체결가 일치(경계 미통과).
3. 10초 경계에서 유리/불리 견적 동작(자동 반영/재확인).
4. 차트: 5분 캔들 렌더.

- [ ] **Step 3: 성능·부하 스팟 체크**

- `/api/price` 엣지 캐시 헤더 확인, 폴링 시 네트워크 탭에서 10초 간격.
- 배치 실행 시간(4,320×42 생성·삽입) 60초 내 확인.

- [ ] **Step 4: 최종 커밋·PR 준비**

```bash
git add -A
git commit -m "chore: 10초 틱 리허설 통합 검증 완료"
```

---

## Self-Review 메모 (작성자 확인)

- **Spec 커버리지**: §4.1 데이터모델→Task 4·5·7 / §4.2 인덱스산출→Task 2·4 / §4.3 공개·체결→Task 4·8·13 / §4.4 연출3층→Task 11·13 / §4.5 견적잠금→Task 12·13 / §5 밸런스→Task 3 / §6 하류일반화→Task 7·17 / §7 운영(캐시·배치·프루닝·다중해상도)→Task 8·9·15·16 / §8 롤아웃(config·리허설)→Task 2·17·18. 모든 절에 대응 Task 존재.
- **미확정(구현 중 확정)**: 프루닝 보관일 3일(Task 16, 조정 가능), 견적 재확인 임계값(정확 불일치 기준, Task 12), 캔들 집계 위치(배치 RPC 내부 선호, Task 6·7).
- **주의**: DB Task(4·7·17)는 "현재 유효 함수 본문을 먼저 `rg`로 찾아 그대로 복사 후 지정 라인만 교체"가 핵심 — 함수 재정의 시 나머지 로직 누락 금지.

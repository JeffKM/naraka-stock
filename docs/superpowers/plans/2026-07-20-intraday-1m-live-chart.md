# 10초 틱 이점 살리기 — 실시간 라인 + 1분봉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 장중 차트를 5분 세계에서 실시간/1분 세계로 옮겨, 봉을 1분봉으로 세밀화하고 오늘 라인 끝에 10초 현재가 tip을 얹어 시세판처럼 살아 움직이게 한다.

**Architecture:** ① `daily_candles`의 집계 버킷을 30틱(5분)→6틱(1분)으로 내려 서버 기본 해상도를 1분으로 만든다(상수 파생이라 게이팅·틱 복원이 자동 반영). ② 차트는 완료된 1분봉만 1분 주기로 받고(미래유출 게이팅 불변), 라인의 맨 앞 tip만 `useQuotes`의 10초 현재가를 붙여 `series.update()`로 갱신한다. tip 시각은 서버와 동일한 `getTickIndex`(현재 틱 클램프) + 공유 epoch 헬퍼로 계산해 미래유출·시간축 어긋남을 원천 차단한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, TanStack Query v5, lightweight-charts, Supabase(Postgres) 마이그레이션.

## Global Constraints

- 아키텍처 원칙 위반 금지: 돈 계산은 서버 함수만(원칙 1), 미래 틱 유출 금지(원칙 2), 자산은 정수 원(원칙 3), 프론트 연출은 표시용·체결가는 서버 틱값(원칙 4).
- TypeScript strict — `any` 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트.
- 임포트: 개별 임포트, 경로 alias `@/*`.
- 코드 주석·커밋 메시지·문서: 한국어. 커밋 형식 `type: 한국어 설명`.
- 이 저장소엔 단위 테스트 러너가 없다. 검증은 `npm run build`, `npx eslint src`(워크트리 lint 스코프), 로컬 `npx supabase db reset` + SQL 확인, `verify` 스킬(dev 서버 + agent-browser)로 한다.
- 마이그레이션 타임스탬프는 `origin/main` 기준 최신값보다 커야 하고 기존 값과 충돌하면 안 된다(과거 조용한 스킵 사고 있었음). 현재 최신 = `20260720020000_fix_backfill_bucketing.sql`.

---

### Task 1: 캔들 기본 해상도 1분으로 (상수 + 집계 함수 + 재빌드)

**Files:**
- Modify: `src/lib/market.ts:17-18` (`CANDLE_INTERVAL_MINUTES`, `TICKS_PER_CANDLE`), `:120-123` (`bucketOfTick` 주석)
- Create: `supabase/migrations/20260720040000_daily_candles_1m.sql`

**Interfaces:**
- Produces: `TICKS_PER_CANDLE === 6`, `CANDLE_INTERVAL_MINUTES === 1` (파생: `bucketOfTick(t) = floor(t/6)`, `totalBuckets = ticksPerDay/6 = 720`). SQL 함수 `build_daily_candles(p_stock_code text, p_date date)`는 6틱=1버킷으로 집계한다. 시그니처·호출부(`batchService`의 `rpc("build_daily_candles", ...)`)는 불변.
- Consumes: 기존 `daily_ticks(stock_code, date, tick_index, price, volume)`, `daily_candles(stock_code, date, bucket, open, high, low, close, volume)` 스키마(변경 없음 — `bucket`은 smallint, CHECK 없어 0~719 수용).

- [ ] **Step 1: market.ts 상수 전환**

`src/lib/market.ts` 17-18행을 교체:

```ts
// 차트 캔들 간격(분)과 캔들당 틱 수 — 10초 틱 6개 = 1분봉
export const CANDLE_INTERVAL_MINUTES = 1;
export const TICKS_PER_CANDLE = (CANDLE_INTERVAL_MINUTES * 60) / TICK_INTERVAL_SECONDS; // 6
```

120-123행 `bucketOfTick` 주석을 "1분"으로 수정:

```ts
// 틱 인덱스 → 1분 캔들 버킷 인덱스
export function bucketOfTick(tickIndex: number): number {
  return Math.floor(tickIndex / TICKS_PER_CANDLE);
}
```

- [ ] **Step 2: 마이그레이션 작성 (집계 함수 /6 + 기존 캔들 재빌드)**

`supabase/migrations/20260720040000_daily_candles_1m.sql` 생성:

```sql
-- daily_candles 1분봉 전환: 집계 버킷 30틱(5분) → 6틱(1분)
--
-- 배경: 10초 틱 이점을 차트에서 살리기 위해 기본 캔들 해상도를 5분 → 1분으로
-- 내린다(설계: docs/superpowers/specs/2026-07-20-intraday-1m-live-chart-design.md).
-- build_daily_candles의 버킷 폭만 /30 → /6으로 바꾸고, 나머지 로직(upsert +
-- 고아 버킷 삭제, 20260719150000_candles_orphan_cleanup.sql)은 그대로 보존한다.
-- 6 = TICKS_PER_CANDLE(=CANDLE_INTERVAL_MINUTES 1분 × 60초 / TICK_INTERVAL_SECONDS 10초).
create or replace function build_daily_candles(p_stock_code text, p_date date)
returns void
language sql
as $$
  insert into daily_candles (stock_code, date, bucket, open, high, low, close, volume)
  select
    p_stock_code,
    p_date,
    (tick_index / 6)::smallint as bucket,
    (array_agg(price order by tick_index))[1]                       as open,
    max(price)                                                      as high,
    min(price)                                                      as low,
    (array_agg(price order by tick_index desc))[1]                  as close,
    coalesce(sum(volume), 0)                                        as volume
  from daily_ticks
  where stock_code = p_stock_code and date = p_date
  group by (tick_index / 6)
  on conflict (stock_code, date, bucket) do update
    set open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, volume = excluded.volume;

  -- 뒷받침 틱이 없어진 고아 버킷 삭제 (틱이 줄어든 재조정/장시간 단축 시)
  delete from daily_candles dc
   where dc.stock_code = p_stock_code and dc.date = p_date
     and not exists (
       select 1 from daily_ticks t
       where t.stock_code = p_stock_code and t.date = p_date
         and (t.tick_index / 6)::smallint = dc.bucket
     );
$$;

-- 기존 5분 버킷 캔들은 버킷 폭이 달라 그대로 두면 차트가 깨진다. 전량 삭제 후,
-- raw 틱이 아직 남아 있는 날(prune_old_ticks가 3일 보존)만 1분 버킷으로 재빌드.
-- 3일보다 오래된 날은 장중 캔들 노출창(INTRADAY_CANDLE_DAYS=3) 밖이라 무해하고,
-- 일봉(daily_summary)은 별도 테이블이라 영향 없다.
delete from daily_candles;
do $$
declare r record;
begin
  for r in select distinct stock_code, date from daily_ticks loop
    perform build_daily_candles(r.stock_code, r.date);
  end loop;
end $$;
```

- [ ] **Step 3: 타임스탬프 충돌 확인**

Run: `git fetch origin -q && ls supabase/migrations | sort | tail -3`
Expected: `20260720040000_daily_candles_1m.sql`가 목록의 최댓값이며, `origin/main`에 같은 타임스탬프가 없어야 한다. 충돌 시 `20260720050000`로 리네임.

- [ ] **Step 4: 로컬 DB 리셋 + 1분 버킷 검증**

Run: `npx supabase db reset`
그다음 버킷 폭이 1분(하루 최대 720버킷)인지 확인:

Run: `npx supabase db reset && echo "select date, count(*) filter (where bucket between 0 and 719) as buckets, max(bucket) as maxb from daily_candles group by date order by date desc limit 3;" | npx supabase db execute --local 2>/dev/null || echo "psql로 대체 확인"`
Expected: 풀데이(12~24시) 종목·날짜의 `maxb`가 143이 아니라 719 근처(마지막 버킷), 종목당 버킷 수가 최대 720. (시드 데이터 장 시간이 짧으면 그에 비례. 핵심은 maxb가 143을 넘어 1분 해상도임을 확인.)

- [ ] **Step 5: 빌드 통과 확인**

Run: `npm run build`
Expected: 성공. `TICKS_PER_CANDLE` 파생 변경으로 인한 타입 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/market.ts supabase/migrations/20260720040000_daily_candles_1m.sql
git commit -m "feat: daily_candles 집계 버킷 5분→1분(6틱) 전환 + 기존 캔들 재빌드"
```

---

### Task 2: chartService — 1분 노출창 + 공유 epoch 헬퍼

**Files:**
- Modify: `src/lib/market.ts` (신규 `chartEpochOfSeconds` export 추가, `tickTimestamp` 아래)
- Modify: `src/services/chartService.ts:2` (import), `:54` (`INTRADAY_CANDLE_DAYS`), `:56-64` (`candleTimeEpoch`), `:13-19`/`:47-48` (주석)

**Interfaces:**
- Consumes: Task 1의 `TICKS_PER_CANDLE=6`, `CANDLE_INTERVAL_MINUTES=1`.
- Produces: `chartEpochOfSeconds(date: string, secondsSinceOpen: number, openHour: number): number` — lightweight-charts용 +9h 보정 epoch(초). 서버(`chartService`)·클라(`StockChart`)가 라이브 tip을 같은 시간축에 놓기 위해 공유. `getChartData`는 `intradayCandles`를 최근 3일치 1분봉으로 반환.

- [ ] **Step 1: market.ts에 공유 epoch 헬퍼 추가**

`src/lib/market.ts`의 `tickTimestamp` 함수(114-118행) 바로 아래에 추가:

```ts
// 차트 표시용 epoch(초): lightweight-charts는 타임스탬프를 UTC 벽시계로 렌더하므로
// +9h 보정해 화면에 KST 시각이 그대로 보이게 한다. 캔들 버킷과 라이브 tip이 같은
// 시간축에 놓이도록 서버(chartService.candleTimeEpoch)와 클라(StockChart tip)가 공유한다.
export function chartEpochOfSeconds(date: string, secondsSinceOpen: number, openHour: number): number {
  const open = String(openHour).padStart(2, "0");
  const base = new Date(`${date}T${open}:00:00+09:00`).getTime();
  return Math.floor(base / 1000) + secondsSinceOpen + 9 * 3600;
}
```

- [ ] **Step 2: chartService가 헬퍼를 쓰도록 candleTimeEpoch 리팩터**

`src/services/chartService.ts` 2행 import에 `chartEpochOfSeconds` 추가:

```ts
import { CANDLE_INTERVAL_MINUTES, TICKS_PER_CANDLE, bucketOfTick, chartEpochOfSeconds, getKstParts, getTickIndex, ticksPerDay } from "@/lib/market";
```

56-64행 `candleTimeEpoch`를 헬퍼 위임으로 교체(주석의 "5분"→"1분", "*300"→"*60" 정정):

```ts
// KST 게임 날짜 + 캔들 버킷(1분 단위) → 차트용 epoch 초 (개장 시각 기준).
// 버킷 폭이 CANDLE_INTERVAL_MINUTES(1분)로 고정이라 bucket * 60초가 성립한다.
function candleTimeEpoch(date: string, bucket: number, openHour: number): number {
  return chartEpochOfSeconds(date, bucket * CANDLE_INTERVAL_MINUTES * 60, openHour);
}
```

- [ ] **Step 3: 노출창을 최근 3일로 축소**

`src/services/chartService.ts` 54행:

```ts
// intradayCandles 페이로드 크기 제한: 1분봉은 하루 최대 720버킷이라 창을 좁힌다.
// 최근 N일치만 노출(전체 추세는 daily_summary 일봉이 담당).
const INTRADAY_CANDLE_DAYS = 3;
```

13-19행 헤더 주석의 "5분 단위로 사전 집계된 daily_candles(종목·일당 ~144행)"를 "1분 단위(종목·일당 최대 720행)"로, 47-48행 `ChartData` 필드 주석의 "5분"을 "1분"으로 정정.

- [ ] **Step 4: 빌드 + lint**

Run: `npm run build && npx eslint src/lib/market.ts src/services/chartService.ts`
Expected: 성공, 경고 없음.

- [ ] **Step 5: 차트 API가 1분봉을 반환하는지 확인**

Run: `npm run dev` (백그라운드) 후 `curl -s localhost:3000/api/stocks/<임의코드>/chart | npx json -e 'this.n=this.intradayCandles.length; this.gap=this.intradayCandles.length>1?this.intradayCandles[1].time-this.intradayCandles[0].time:null' n gap 2>/dev/null || curl -s localhost:3000/api/stocks/<임의코드>/chart | head -c 400`
Expected: `intradayCandles`의 인접 `time` 간격이 60(초) = 1분. (직전 세션 데이터가 있어야 함 — 없으면 db reset 시드로 확인.)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/market.ts src/services/chartService.ts
git commit -m "feat: 차트 공유 epoch 헬퍼 추출 + 장중 캔들 1분·최근3일 노출"
```

---

### Task 3: StockChart — 1분(m1) 토글 추가 + m5 재집계 전환

**Files:**
- Modify: `src/components/chart/StockChart.tsx:60-67` (`Mode`, `MINUTES_BY_MODE`), `:179-188` (`candleData`), `:284-291` (탭 UI)

**Interfaces:**
- Consumes: Task 2의 1분봉 `intradayCandles`(서버 응답).
- Produces: 차트 토글 `line | m1 | m5 | m15 | m30 | m60 | daily`. `m1`은 원본 1분봉, 나머지 분봉은 1분봉을 N개씩 `aggregateOhlcCandles`로 묶어 재집계(m5 포함).

- [ ] **Step 1: Mode 타입과 MINUTES_BY_MODE 갱신**

`src/components/chart/StockChart.tsx` 60-67행 교체:

```ts
// 라인(당일) / 1분·N분 OHLC 캔들(1분봉을 N개 집계) / 일봉 캔들
type Mode = "line" | "m1" | "m5" | "m15" | "m30" | "m60" | "daily";

// m1은 원본 1분봉을 그대로 쓰고, 나머지는 1분봉 N개를 묶어 재집계한다.
const MINUTES_BY_MODE: Record<Exclude<Mode, "line" | "daily" | "m1">, number> = {
  m5: 5,
  m15: 15,
  m30: 30,
  m60: 60,
};
```

- [ ] **Step 2: candleData 분기 갱신 (m1 원본, 나머지 집계)**

179-188행의 `candleData` 산출을 교체(주석도 1분 기준으로):

```ts
    // 캔들 데이터(일봉/1분/N분 집계) — 라인 모드에서는 빈 배열. 일봉은 날짜 문자열, 나머지는 초 단위 epoch.
    // m1은 서버가 내려주는 원본 1분봉을 그대로 쓰고, m5/m15/m30/m60은 1분봉을 N개씩 묶어 재집계한다.
    const candleData: ChartCandle[] =
      mode === "daily"
        ? data.daily.map((d) => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }))
        : mode === "line"
          ? []
          : mode === "m1"
            ? data.intradayCandles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }))
            : aggregateOhlcCandles(data.intradayCandles, MINUTES_BY_MODE[mode as "m5" | "m15" | "m30" | "m60"]);
```

- [ ] **Step 3: 탭 UI에 1분 추가**

284-291행 `TabsList`에서 라인과 5분 사이에 1분 트리거 삽입:

```tsx
          <TabsList>
            <TabsTrigger value="line">라인</TabsTrigger>
            <TabsTrigger value="m1">1분</TabsTrigger>
            <TabsTrigger value="m5">5분</TabsTrigger>
            <TabsTrigger value="m15">15분</TabsTrigger>
            <TabsTrigger value="m30">30분</TabsTrigger>
            <TabsTrigger value="m60">1시간</TabsTrigger>
            <TabsTrigger value="daily">일봉</TabsTrigger>
          </TabsList>
```

- [ ] **Step 4: 빌드 + lint**

Run: `npm run build && npx eslint src/components/chart/StockChart.tsx`
Expected: 성공. `MINUTES_BY_MODE[mode as "m5" | ...]` 캐스트 타입 에러 없음.

- [ ] **Step 5: 브라우저 검증 (verify 스킬)**

`verify` 스킬(dev + agent-browser)로 종목 상세(`/stocks/[code]`) 진입 후 1분/5분/15분/30분/1시간/일봉 토글을 각각 눌러 캔들이 렌더되는지 확인. 특히 **1분 탭이 5분보다 촘촘한 캔들**을 그리는지, 5분 탭이 여전히 정상(1분봉 5개 묶음)인지 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/components/chart/StockChart.tsx
git commit -m "feat: 차트에 1분봉(m1) 토글 추가, 5분봉을 1분봉 재집계로 통일"
```

---

### Task 4: StockChart — 실시간 10초 tip + 폴링 정비

**Files:**
- Modify: `src/components/chart/StockChart.tsx` — import(3-16행), 라인 시리즈 ref, `liveTip` useMemo, tip 반영 effect, `chartEmpty`(275-278행), `refetchInterval`(136행) 및 stale 주석
- Modify: `src/components/quotes/AssetSummaryCard.tsx:42` (stale 주석 정정)

**Interfaces:**
- Consumes: Task 2의 `chartEpochOfSeconds`, 기존 `getTickIndex`·`getKstParts`·`TICK_INTERVAL_SECONDS`(@/lib/market), `useQuotes`(@/hooks/useQuotes)의 `QuoteBoardDto`(`marketState`, `asOf`, `market.{openHour,closeHour,closedWeekdays}`, `quotes: {code, price}[]`).
- Produces: 라인 모드에서 완료 1분봉 라인 끝에 현재 종목의 10초 현재가 tip을 `series.update()`로 얹는다. tip 시각 = `getTickIndex`로 현재 틱 클램프(미래유출 불가) → `chartEpochOfSeconds`.

- [ ] **Step 1: import 추가**

3-16행 import 블록에 추가/수정:
- react: `useMemo` 추가 → `import { useEffect, useMemo, useRef, useState } from "react";`
- lightweight-charts: `type ISeriesApi` 추가 → 기존 import에 `type ISeriesApi` 포함
- `import { useQuotes } from "@/hooks/useQuotes";` 추가
- market import 확장 → `import { chartEpochOfSeconds, formatMoney, getKstParts, getTickIndex, TICK_INTERVAL_SECONDS } from "@/lib/market";`

- [ ] **Step 2: 라인 시리즈 ref + useQuotes 구독 + liveTip 계산**

컴포넌트 본문에서 `chartRef` 선언(131행) 아래에 추가:

```ts
  const lineSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const { data: board } = useQuotes();

  // 라인 tip: 현재 종목의 10초 현재가를 라인 끝에 얹기 위한 {time, value}.
  // time은 서버 candleTimeEpoch와 동일 규약(chartEpochOfSeconds)으로, getTickIndex가
  // 현재 틱으로 클램프하므로 미래 틱은 절대 새지 않는다(원칙 2). 장중·해당 종목 시세가
  // 있을 때만 non-null.
  const liveTip = useMemo(() => {
    if (mode !== "line" || !board || board.marketState !== "open") return null;
    const q = board.quotes.find((x) => x.code === code);
    if (!q) return null;
    const hours = { openHour: board.market.openHour, closeHour: board.market.closeHour };
    const now = new Date(board.asOf);
    const tickIdx = getTickIndex(now, hours, { closedWeekdays: board.market.closedWeekdays });
    if (tickIdx === null) return null;
    const { date } = getKstParts(now);
    return { time: chartEpochOfSeconds(date, tickIdx * TICK_INTERVAL_SECONDS, hours.openHour), value: q.price };
  }, [board, mode, code]);
```

- [ ] **Step 3: 빌드 시 라인 시리즈를 ref에 저장**

빌드 effect의 라인 시리즈 생성 직후(163-177행 `priceSeries` 산출 뒤)에 ref 저장을 추가하고, cleanup(265-270행)에서 null 처리. `priceSeries` 산출 블록 바로 다음 줄에 삽입:

```ts
    if (mode === "line") {
      lineSeriesRef.current = priceSeries as ISeriesApi<"Area">;
    }
```

cleanup의 `return () => { ... }` 안(예: `chart.remove();` 다음)에 추가:

```ts
      lineSeriesRef.current = null;
```

- [ ] **Step 4: tip 반영 effect 추가**

빌드 effect(271행 `}, [data, mode]);`) **다음에** 별도 effect 추가. 순서상 빌드 effect가 먼저 시리즈를 만들고, 이 effect가 tip을 얹는다. `data` 의존으로 1분 리빌드 후에도 tip이 재적용된다:

```ts
  // 라이브 tip 반영: 10초마다 board가 갱신되면 라인 끝 점만 update. 빌드 effect가
  // data/mode 변화로 시리즈를 다시 만든 직후에도 재적용되도록 data를 의존에 둔다.
  useEffect(() => {
    if (!liveTip) return;
    const series = lineSeriesRef.current;
    if (!series) return;
    series.update({ time: liveTip.time as never, value: liveTip.value });
  }, [liveTip, data]);
```

- [ ] **Step 5: chartEmpty가 라이브 tip을 고려하도록 수정**

275-278행 `chartEmpty`를 교체 — 장중 첫 1분처럼 today가 비어도 tip이 있으면 빈 화면을 띄우지 않는다:

```ts
  const chartEmpty =
    data &&
    ((mode === "line" && data.today.length === 0 && !liveTip) ||
      (mode !== "line" && mode !== "daily" && data.intradayCandles.length === 0));
```

- [ ] **Step 6: 차트 폴링 주기 정비 (5분→1분) + stale 주석**

133-137행 `useQuery`의 `refetchInterval` 교체:

```ts
  const { data, isLoading } = useQuery({
    queryKey: ["chart", code],
    queryFn: () => getJson<ChartDto>(`/api/stocks/${code}/chart`),
    refetchInterval: 60_000, // 완료된 1분봉 갱신 — 라인 끝 tip은 useQuotes(10초)가 담당
  });
```

`src/components/quotes/AssetSummaryCard.tsx:42`의 stale 주석 `// 5분 틱 갱신을 놓치지 않게 폴링 ...`을 `// 10초 틱 갱신을 놓치지 않게 폴링 (카운트업 연출의 전제)`로 정정.

- [ ] **Step 7: 빌드 + lint**

Run: `npm run build && npx eslint src/components/chart/StockChart.tsx src/components/quotes/AssetSummaryCard.tsx`
Expected: 성공, 경고 없음.

- [ ] **Step 8: 브라우저 검증 (장중 tip 이동 + 미래유출 없음)**

`verify` 스킬로, 장중이 되도록 config 오버라이드(`rehearsal-render-chart-before-event` 메모 기법: open=0/close=12/extra_open_days + 오늘 틱 삽입)한 뒤 라인 탭에서:
- 라인 끝 점(tip)이 **10초마다 현재가로 갱신**되며 x축이 현재 KST 시각까지 진행하는지
- tip 시각이 **현재 틱을 넘어 미래로 가지 않는지**(완료 1분봉 라인 + 현재가 한 점까지만)
- 5분/일봉 등 다른 탭에는 tip이 안 붙는지(라인 전용)

- [ ] **Step 9: 커밋**

```bash
git add src/components/chart/StockChart.tsx src/components/quotes/AssetSummaryCard.tsx
git commit -m "feat: 차트 라인에 10초 현재가 tip 실시간 반영 + 폴링 1분으로 정비"
```

---

### Task 5: 문서 동기화 + 최종 검증

**Files:**
- Modify: `docs/PRD.md` (틱·차트 명세 중 5분틱→10초틱·1분봉으로 이미 어긋난 라인)
- Modify: `docs/ROADMAP.md` (완료 Task 반영)

**Interfaces:**
- Consumes: Task 1~4의 완성 동작.
- Produces: 문서가 실제 동작과 일치.

- [ ] **Step 1: PRD의 차트/틱 명세 정정**

`docs/PRD.md`에서 이 작업으로 사실이 바뀐 라인만 정정(전면 개편 아님, YAGNI):
- 199행 `일봉 캔들차트 + 당일 5분봉` → `일봉 캔들차트 + 당일 1분봉(+실시간 라인 tip)`
- 39행 `주가 갱신 | 5분 주기 틱` 계열이 아직 5분으로 남아 있으면 `10초 주기 틱`으로 정정(10초 전환 미반영분 동반 정리).

(주의: 가격 엔진·틱 생성 규칙 자체는 이 작업 범위 밖 — 차트 표시 관련 문장만 손댄다.)

- [ ] **Step 2: ROADMAP에 완료 항목 추가**

`docs/ROADMAP.md`의 적절한 Phase에 체크된 항목으로 추가:

```markdown
- [x] 차트 1분봉(m1) 토글 + 오늘 라인 10초 실시간 tip (10초 틱 이점 살리기, 2026-07-20)
```

- [ ] **Step 3: 전체 빌드 + lint 최종 확인**

Run: `npm run build && npx eslint src`
Expected: 성공, 경고 0.

- [ ] **Step 4: 커밋**

```bash
git add docs/PRD.md docs/ROADMAP.md
git commit -m "docs: 차트 1분봉·실시간 tip 반영 (PRD·ROADMAP 동기화)"
```

---

## Self-Review

**Spec coverage:**
- 축 1 실시간 라인(접근 2, 10초 tip) → Task 4. tip 시각이 `getTickIndex` 클램프 + 공유 epoch(Task 2)로 미래유출 차단.
- 축 2 1분봉(버킷 5분→1분, m1 토글, 최근 3일) → Task 1(집계)·Task 2(노출창)·Task 3(토글).
- 이중 폴링(완료봉 1분 + tip 10초) → Task 4 Step 4·6.
- 재빌드를 reset으로 처리 → Task 1 Step 2(마이그레이션 내 delete+rebuild)·Step 4(로컬 reset).
- stale 주석 정리 → Task 2/4/5.
- 안전성(원칙 1·2·4) → Global Constraints + Task 4 Step 2/8.
- 스코프 외(접근 3, wiggle 개편, 거래량 tip) → 미포함(YAGNI 준수).

**Placeholder scan:** `<임의코드>`는 실행자가 채우는 런타임 값(플레이스홀더 아님, 명시함). 그 외 TBD/TODO 없음.

**Type consistency:** `TICKS_PER_CANDLE=6`/`CANDLE_INTERVAL_MINUTES=1`(Task1) → chartService·tickService·quoteService 파생 반영(변경 불필요, 확인함). `chartEpochOfSeconds` 시그니처 Task2 정의 = Task4 사용 일치. `liveTip` 형태 `{time, value}` = Task4 Step2 정의 = Step4 사용 일치. `Mode` 유니언(Task3) = candleData 캐스트 `"m5"|"m15"|"m30"|"m60"` 일치. `ISeriesApi<"Area">` ref 타입 = 라인 시리즈(AreaSeries) 일치.

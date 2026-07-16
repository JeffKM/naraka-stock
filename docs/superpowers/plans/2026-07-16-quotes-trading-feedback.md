# 시세·거래 피드백 6종 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 손님/운영 피드백 6종(관심종목 탭 · 수량 매수 · 섹터+뉴스 연동 · 봉 고저 · 시뮬 거래량 · 봉 OHLCV 툴팁)을 사전 생성 가격 아키텍처를 유지하며 구현한다.

**Architecture:** 가격·거래량·편향은 폐장 배치가 TS 엔진(`src/lib/engine/*`, `src/lib/news/generate.ts`)에서 사전 생성해 `apply_daily_batch()` 단일 트랜잭션으로 `daily_ticks`/`daily_summary`에 저장하고, 장중엔 읽기만 한다. 모든 돈 계산은 Postgres RPC 단일 트랜잭션(클라이언트 값 불신). 자산은 정수 원, 수량은 `numeric(20,6)`.

**Tech Stack:** Next.js 16(App Router) + React 19, TypeScript strict, Supabase(Postgres, service-role only), TanStack Query v5, lightweight-charts ^5.2, Zod v4, TailwindCSS v4 + shadcn/ui.

## Global Constraints

- 코드 주석·커밋 메시지·문서: 한국어. 변수/함수: camelCase, 컴포넌트: PascalCase.
- TypeScript strict — `any` 금지. 들여쓰기 2칸, 세미콜론, 더블 쿼트.
- 돈은 정수(원). 수량만 `numeric`. 부동소수점 금지.
- 체결가·수수료·밴드 판정은 전부 서버. 클라이언트가 보낸 가격·잔고 불신.
- 테스트 러너 없음. 검증 = `npm run build` + `npm run lint` + `npm run simulate`(엔진/밸런스) + `verify` 스킬(dev + agent-browser 실앱) + SQL 직접 실행(`p_at`/`?date=` 오버라이드).
- UI 문구에 이모지 금지.
- DB/엔진 변경(A·B) 후에는 어드민 콘솔 "리허설 데이터 초기화"로 재생성 필요.
- 커밋은 `type: 한국어 설명` 형식. 각 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**신규 파일**
- `supabase/migrations/20260716010000_sector.sql` — `stocks.sector` 컬럼 + 27종 배정
- `supabase/migrations/20260716020000_volume.sql` — `daily_ticks`/`daily_summary` volume 컬럼 + `apply_daily_batch` 재정의(volume 반영)
- `supabase/migrations/20260716030000_watchlist.sql` — `watchlists` 테이블 + `toggle_watchlist` RPC
- `supabase/migrations/20260716040000_buy_quantity.sql` — `execute_trade` 재정의(매수 정수 수량 허용)
- `src/services/watchlistService.ts` — 관심종목 조회/토글 서비스
- `src/app/api/watchlist/route.ts` — GET(목록)/POST(토글)
- `src/hooks/useWatchlist.ts` — 관심종목 조회 + 토글 mutation 훅

**수정 파일**
- `src/types/domain.ts` — `StockSector` 유니온 추가, `Stock.sector`, `StockQuote.sector` + `volume` 주석 의미 갱신
- `src/lib/engine/bias.ts` — `BiasTarget.sector`, 섹터 이벤트 편향
- `src/lib/engine/randomWalk.ts` — `Tick.volume`/`DailyPath` volume, 거래량 생성
- `src/lib/news/generate.ts` — 섹터 뉴스 생성 함수
- `src/services/batchService.ts` — sector select, 섹터 편향/뉴스 연동, volume 주입
- `src/services/quoteService.ts` — sector select, volume을 시뮬 틱 누적으로
- `src/services/chartService.ts` — `IntradayPoint`/`DailyCandle`에 volume 필드 추가 + 틱/요약 volume 반환
- `src/services/adminService.ts` — 시세조정 재생성 틱에 volume 주입(정확 위치는 grep)
- `src/components/chart/StockChart.tsx` — 거래량 히스토그램 + 크로스헤어 OHLCV 툴팁 + 고저 마커 + aggregateCandles volume
- `src/components/trade/TradePanel.tsx` — BuyDialog 금액/수량 토글
- `src/lib/validation/trade.ts` — 매수 수량(정수) 허용
- `src/app/page.tsx` — 섹터 뱃지, 거래량 컬럼, 전체/관심 탭
- `src/app/stocks/[code]/page.tsx` — 섹터 뱃지, 관심 토글
- `src/components/quotes/StockStats.tsx` — 거래량 라벨(시뮬 기준으로 의미 확인)

---

## 섹터 배정표 (Task A1에서 사용)

`sector` slug → 라벨, 종목:
- `semiconductor` 반도체: MLVD, OKHX
- `electronics` 전기전자: NRKE, MAPL
- `it` IT·플랫폼: ALBN, NOMH, MRSF, MRCL, BBNN, MLTA
- `retail` 유통·소비재: BNZN, MLMT, OKCT, MIPA, MHBT, OKCC
- `auto` 자동차: OKSL, NRKM
- `media` 미디어·엔터: OKFX, MHEN
- `finance` 금융: BNSK, MRFI
- `defense` 방산·중공업: SPCO, BNAS, BNOC
- `bio` 바이오·제약: NRKB, MELL

---

## Task A1: 섹터 컬럼 + 27종 배정 + 도메인 타입

**Files:**
- Create: `supabase/migrations/20260716010000_sector.sql`
- Modify: `src/types/domain.ts` (StockTier 아래에 StockSector 추가, Stock/StockQuote)

**Interfaces:**
- Produces: `stocks.sector text not null`; `StockSector` 유니온 타입; `Stock.sector: StockSector`; `StockQuote.sector: StockSector`.

- [ ] **Step 1: 마이그레이션 작성** — `supabase/migrations/20260716010000_sector.sql`

```sql
-- 종목 섹터 분류 (피드백 3) — tier(우량/일반/테마)와 직교하는 업종 축.
-- 표시·필터·뉴스 섹터 이벤트 타겟팅에 쓴다. 지수 분류(NASPI/NASDAK)는 tier 파생 그대로.
alter table stocks add column if not exists sector text;

update stocks set sector = 'semiconductor' where code in ('MLVD','OKHX');
update stocks set sector = 'electronics'   where code in ('NRKE','MAPL');
update stocks set sector = 'it'            where code in ('ALBN','NOMH','MRSF','MRCL','BBNN','MLTA');
update stocks set sector = 'retail'        where code in ('BNZN','MLMT','OKCT','MIPA','MHBT','OKCC');
update stocks set sector = 'auto'          where code in ('OKSL','NRKM');
update stocks set sector = 'media'         where code in ('OKFX','MHEN');
update stocks set sector = 'finance'       where code in ('BNSK','MRFI');
update stocks set sector = 'defense'       where code in ('SPCO','BNAS','BNOC');
update stocks set sector = 'bio'           where code in ('NRKB','MELL');

-- 이후 신규 종목 강제: NOT NULL + 체크
alter table stocks alter column sector set not null;
alter table stocks add constraint stocks_sector_check
  check (sector in ('semiconductor','electronics','it','retail','auto','media','finance','defense','bio'));
```

- [ ] **Step 2: 도메인 타입 추가** — `src/types/domain.ts`

`StockTier` 정의 바로 아래에 추가:

```typescript
export type StockSector =
  | "semiconductor"
  | "electronics"
  | "it"
  | "retail"
  | "auto"
  | "media"
  | "finance"
  | "defense"
  | "bio";
```

`Stock` 인터페이스에 `sector: StockSector;` 추가(`tier` 다음 줄). `StockQuote` 인터페이스에 `sector: StockSector;` 추가(`tier` 다음 줄).

- [ ] **Step 3: 마이그레이션 적용 + 검증**

Run: `npx supabase db reset`
그다음 SQL로 확인:
```bash
npx supabase db reset && echo "SELECT sector, count(*) FROM stocks GROUP BY sector ORDER BY sector;" | npx supabase db execute --stdin 2>/dev/null || psql "$DATABASE_URL" -c "select sector, count(*) from stocks group by sector order by sector;"
```
Expected: 9개 섹터, 합계 27종. `sector` NULL 없음.

- [ ] **Step 4: 타입 체크**

Run: `npm run build`
Expected: `Stock`/`StockQuote`에 sector 필드가 없어서 이를 생성하는 서비스(quoteService 등)에서 타입 에러 발생 → Task A2에서 채운다. 이 단계에서 빌드가 깨지면 정상. (A2까지 완료 후 통과.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260716010000_sector.sql src/types/domain.ts
git commit -m "feat: 종목 섹터 컬럼 추가 및 27종 업종 배정

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A2: 섹터 서비스 노출 + 프론트 뱃지

**Files:**
- Modify: `src/services/quoteService.ts:49-53`(stocks select), `:146-173`(quote 매핑)
- Modify: `src/app/page.tsx:21`(라벨), `:62-119`(QuoteRow)
- Modify: `src/app/stocks/[code]/page.tsx`(섹터 뱃지 — 상세 헤더)

**Interfaces:**
- Consumes: `StockQuote.sector`(A1)
- Produces: `SECTOR_LABEL` 라벨 맵(page.tsx export), 시세판·상세에 섹터 뱃지.

- [ ] **Step 1: quoteService에 sector select 추가** — `src/services/quoteService.ts`

`:49-53`의 select를 다음으로:
```typescript
  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("code, name, tier, sector, shares_outstanding")
    .eq("listed", true)
    .order("code");
```

`:154-172`의 quote 객체에 `sector` 추가(`tier` 다음 줄):
```typescript
      tier: stock.tier as StockTier,
      sector: stock.sector as StockSector,
```
파일 상단 import에 `StockSector` 추가: `import type { IndexQuote, MarketState, StockQuote, StockSector, StockTier } from "@/types/domain";`

- [ ] **Step 2: 라벨 맵 + 시세판 뱃지** — `src/app/page.tsx`

`TIER_LABEL` 옆에 추가:
```typescript
const SECTOR_LABEL: Record<StockQuote["sector"], string> = {
  semiconductor: "반도체",
  electronics: "전기전자",
  it: "IT·플랫폼",
  retail: "유통·소비재",
  auto: "자동차",
  media: "미디어·엔터",
  finance: "금융",
  defense: "방산·중공업",
  bio: "바이오·제약",
};
```

`QuoteRow`의 tier 라벨 줄(`:75`)을 tier + 섹터로:
```tsx
          <p className="text-xs text-muted-foreground">
            {TIER_LABEL[q.tier]} · {SECTOR_LABEL[q.sector]}
          </p>
```

- [ ] **Step 3: 종목 상세 섹터 뱃지** — `src/app/stocks/[code]/page.tsx`

기존 tier 라벨 매핑(`:20`) 옆에 동일한 `SECTOR_LABEL`을 두고, 종목명 헤더 근처에 섹터를 함께 표기(기존 tier 표기 방식과 동일한 위치·스타일). 정확한 표기 위치는 파일의 현재 tier 라벨 렌더 지점을 grep해 그 옆에 `· {SECTOR_LABEL[sector]}` 형태로 추가. 상세 페이지 데이터가 sector를 포함하는지 확인하고(quote를 쓰면 A1/이 태스크로 이미 포함), 없으면 stock select에 sector 추가.

- [ ] **Step 4: 빌드·린트·실앱 검증**

Run: `npm run build && npm run lint`
Expected: 통과(A1의 타입 에러 해소됨).
그다음 `verify` 스킬로 홈 시세판에 "우량주 · 반도체" 식 라벨이 뜨는지 확인.

- [ ] **Step 5: Commit**

```bash
git add src/services/quoteService.ts src/app/page.tsx src/app/stocks/
git commit -m "feat: 시세판·종목 상세에 섹터 라벨 표시

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A3: 섹터 뉴스 연동 (편향 + 뉴스)

**Files:**
- Modify: `src/lib/engine/bias.ts`(BiasTarget에 sector, 섹터 이벤트)
- Modify: `src/lib/news/generate.ts`(섹터 뉴스 생성 함수)
- Modify: `src/services/batchService.ts:95-99`(sector select), `:107-187`(연동)

**Interfaces:**
- Consumes: `stocks.sector`, `BiasMap`(bias.ts 기존)
- Produces: `drawDailyBiases`가 섹터 공통 편향 포함; `generateSectorNews(sectorEvent, tomorrowDate, openHour, rng): GeneratedNews[]`; `SectorEvent { sector, direction, magnitude }`.

- [ ] **Step 1: bias.ts에 sector 필드 + 섹터 이벤트 추가** — `src/lib/engine/bias.ts`

`BiasTarget`에 sector 추가:
```typescript
export interface BiasTarget {
  code: string;
  tier: StockTier;
  sector: string;
}
```

파일 하단에 섹터 이벤트 상수·타입·함수 추가(개별 편향 위에 덧대는 레이어):
```typescript
// 섹터 이벤트 (피드백 3): 하루 확률적으로 섹터 1개를 골라 그 섹터 전 종목에
// 공통 방향 편향을 개별 편향에 가산한다. 섹터 뉴스는 이 결과를 설명하는 정식뉴스로
// 후반 노출된다(추종 이득 없음 — generate.ts 정책 준수).
const SECTOR_EVENT_PROBABILITY = 0.5; // 하루 섹터 이벤트 발생 확률
const SECTOR_MAGNITUDE = 8; // 섹터 공통 편향 세기(%p) — 개별 이벤트보다 작게(밸런스 튜닝 대상)
const SECTOR_UP_PROBABILITY = 0.55;

export interface SectorEvent {
  sector: string;
  direction: 1 | -1;
  magnitude: number;
}

// 섹터 이벤트 추첨 (RNG 소비: 발생판정 1 + [발생 시 섹터선택 1 + 방향 1]).
// 발생하지 않으면 null. 대상 섹터가 종목에 없으면 무효.
export function drawSectorEvent(
  stocks: BiasTarget[],
  rng: Rng
): SectorEvent | null {
  if (rng() >= SECTOR_EVENT_PROBABILITY) return null;
  const sectors = Array.from(new Set(stocks.map((s) => s.sector)));
  if (sectors.length === 0) return null;
  const sector = sectors[Math.floor(rng() * sectors.length)];
  const direction = rng() < SECTOR_UP_PROBABILITY ? 1 : -1;
  return { sector, direction, magnitude: SECTOR_MAGNITUDE };
}

// 개별 편향 맵에 섹터 공통 편향을 가산 (클램프 -30~+30)
export function applySectorEvent(biases: BiasMap, stocks: BiasTarget[], event: SectorEvent | null): BiasMap {
  if (!event) return biases;
  const merged: BiasMap = { ...biases };
  for (const s of stocks) {
    if (s.sector !== event.sector) continue;
    const next = (merged[s.code] ?? 0) + event.direction * event.magnitude;
    merged[s.code] = Math.max(-30, Math.min(30, next));
  }
  return merged;
}
```

- [ ] **Step 2: generate.ts에 섹터 뉴스 함수 추가** — `src/lib/news/generate.ts`

파일 하단에 추가(기존 `tailNewsTick`/후반 노출 유틸 재사용 — 정식뉴스와 같은 후반 스탬프). 섹터 라벨 맵과 문안 템플릿:
```typescript
// 섹터 뉴스 (피드백 3): 섹터 이벤트를 설명하는 정식뉴스 1건. stock_code=null(섹터 전체).
// 노출은 정식뉴스와 동일하게 장 후반(사후 설명 → 추종 이득 없음).
const SECTOR_NEWS_LABEL: Record<string, string> = {
  semiconductor: "반도체", electronics: "전기전자", it: "IT·플랫폼",
  retail: "유통·소비재", auto: "자동차", media: "미디어·엔터",
  finance: "금융", defense: "방산·중공업", bio: "바이오·제약",
};

export interface SectorNewsInput {
  sector: string;
  direction: 1 | -1;
}

// 섹터 뉴스 1건 생성. openHour 기준 장 후반(0.8 지점) 틱에 published_at 스탬프.
export function generateSectorNews(
  input: SectorNewsInput | null,
  totalTicks: number,
  tomorrowDate: string,
  openHour: number,
  rng: Rng
): GeneratedNews[] {
  if (!input) return [];
  const label = SECTOR_NEWS_LABEL[input.sector] ?? input.sector;
  const up = input.direction === 1;
  const tick = Math.min(totalTicks - 1, Math.floor(totalTicks * 0.8));
  const title = up ? `${label} 업종 전반 강세` : `${label} 업종 전반 약세`;
  const body = up
    ? `${label} 관련주들이 동반 상승하고 있다. 업종 전반에 매수세가 유입되는 분위기다.`
    : `${label} 관련주들이 동반 하락하고 있다. 업종 전반에 차익 실현 매물이 나오고 있다.`;
  return [{
    date: tomorrowDate,
    stockCode: null,
    grade: "news",
    title,
    body,
    publishedAt: tickTimestamp(tomorrowDate, tick, openHour),
  }];
}
```
(주의: `tickTimestamp` import가 generate.ts에 이미 있는지 확인 — 없으면 `@/lib/market`에서 추가. `Rng`·`GeneratedNews`는 이미 존재.)

- [ ] **Step 3: batchService 연동** — `src/services/batchService.ts`

`:95-99` stocks select에 sector 추가:
```typescript
  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("code, name, tier, sector")
    .eq("listed", true);
```

`:114-117` drawDailyBiases 호출에 sector 전달 + 섹터 이벤트 추첨·가산:
```typescript
    const biasTargets = stocks.map((s) => ({
      code: s.code,
      tier: s.tier as StockTier,
      sector: s.sector as string,
    }));
    biases = drawDailyBiases(biasTargets, rng);
    const sectorEvent = drawSectorEvent(biasTargets, rng);
    biases = applySectorEvent(biases, biasTargets, sectorEvent);
```
import 갱신: `import { applySectorEvent, drawDailyBiases, drawSectorEvent, realizeBias } from "@/lib/engine/bias";`

`:175-186` generateRegularNews 뒤에 섹터 뉴스 push:
```typescript
    news.push(
      ...generateSectorNews(
        sectorEvent ? { sector: sectorEvent.sector, direction: sectorEvent.direction } : null,
        config.ticksPerDay,
        tomorrowDate,
        config.openHour,
        rng
      )
    );
```
import에 `generateSectorNews` 추가(generate.ts import 블록).

> **RNG 순서 주의:** `drawSectorEvent`는 `drawDailyBiases` **직후**, `generateDailyPath` 루프 진입 **전**에 호출해야 시드 재현성이 유지된다(중간 삽입 금지). 위 배치가 그 순서다.

- [ ] **Step 4: 시뮬레이션 밸런스 검증**

Run: `npm run simulate -- --runs 500`
Expected: 정상 완료. 섹터 편향(±8%p)이 추종 지배 전략을 만들지 않는지 확인 — 기존 지표(추종 중앙값 ≈ 본전, 원금손실 비율, 상하 스프레드)가 기존 대비 크게 무너지지 않아야 한다. 무너지면 `SECTOR_MAGNITUDE`·`SECTOR_EVENT_PROBABILITY`를 낮춰 재검증.

- [ ] **Step 5: 빌드·린트 + 배치 실행 검증**

Run: `npm run build && npm run lint`
그다음 로컬에서 배치를 돌려 섹터 뉴스(stock_code=null, "○○ 업종 전반 강세")가 생성되는지 확인:
```bash
curl -X POST "localhost:3000/api/cron/daily-batch?date=2026-08-01" -H "Authorization: Bearer $CRON_SECRET"
```
(dev 서버 구동 상태에서. `verify` 스킬 절차 준용.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/bias.ts src/lib/news/generate.ts src/services/batchService.ts
git commit -m "feat: 섹터 이벤트 편향 및 섹터 뉴스 연동

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B1: 거래량 DB 컬럼 + 배치 반영

**Files:**
- Create: `supabase/migrations/20260716020000_volume.sql`

**Interfaces:**
- Produces: `daily_ticks.volume bigint not null default 0`; `daily_summary.volume bigint not null default 0`; `apply_daily_batch(... p_ticks 포함 volume, p_settle 정산 시 sum(volume))`.

- [ ] **Step 1: 마이그레이션 작성** — `supabase/migrations/20260716020000_volume.sql`

`apply_daily_batch`의 최신 정의(`20260712030000_news_batch.sql`)를 복사해, (a) 정산 시 `sum(t.volume)`, (b) 익일 틱/요약 삽입에 volume 컬럼을 추가한다.

```sql
-- 시뮬레이션 거래량 (피드백 5,6): 틱/요약에 volume 저장. 사전 생성 경로(가격과 동일)
-- 로 만든 시장 거래량. 참가자 실제 체결(trades 집계)과는 별개 레이어(인기종목이 담당).
alter table daily_ticks add column if not exists volume bigint not null default 0;
alter table daily_summary add column if not exists volume bigint not null default 0;

-- apply_daily_batch 재정의: 시그니처 동일(파라미터 jsonb 내 컬럼만 확장)이라 CREATE OR REPLACE로 교체.
create or replace function apply_daily_batch(
  p_today date,
  p_settle boolean,
  p_pay_dividend boolean,
  p_dividend_percent int,
  p_tomorrow date,
  p_summaries jsonb,
  p_ticks jsonb,
  p_news jsonb default '[]'
) returns jsonb
language plpgsql
as $$
declare
  v_dividends_paid int := 0;
  v_ticks_inserted int := 0;
  v_news_inserted int := 0;
  v_last_dividend date;
begin
  -- 1) 오늘 정산: 실제 틱에서 OHLC + 거래량 합 재계산
  if p_settle then
    insert into daily_summary (stock_code, date, open, high, low, close, bias, volume)
    select t.stock_code, p_today,
      (array_agg(t.price order by t.tick_index asc))[1],
      max(t.price), min(t.price),
      (array_agg(t.price order by t.tick_index desc))[1],
      0,
      coalesce(sum(t.volume), 0)
    from daily_ticks t
    where t.date = p_today
    group by t.stock_code
    on conflict (stock_code, date) do update
      set open = excluded.open, high = excluded.high,
          low = excluded.low, close = excluded.close, volume = excluded.volume;
  end if;

  -- 2) 금요일 배당 (기존과 동일)
  if p_pay_dividend then
    select (value #>> '{}')::date into v_last_dividend
      from config where key = 'last_dividend_date';
    if v_last_dividend is null or v_last_dividend < p_today then
      with payouts as (
        select h.user_id,
          sum(floor(h.quantity * s.close * p_dividend_percent / 100.0))::bigint as amount
        from holdings h
        join stocks st on st.code = h.stock_code and st.tier = 'stable'
        join daily_summary s on s.stock_code = h.stock_code and s.date = p_today
        where h.quantity > 0
        group by h.user_id
      )
      update users u set cash = u.cash + p.amount
        from payouts p where u.id = p.user_id and p.amount > 0;
      get diagnostics v_dividends_paid = row_count;
      insert into config (key, value)
        values ('last_dividend_date', to_jsonb(p_today::text))
        on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
  end if;

  -- 3) 익일 경로 반영 (volume 포함)
  if p_tomorrow is not null then
    delete from daily_ticks where date = p_tomorrow;
    delete from daily_summary where date = p_tomorrow;

    insert into daily_summary (stock_code, date, open, high, low, close, bias, volume)
    select x.stock_code, p_tomorrow, x.open, x.high, x.low, x.close, x.bias, x.volume
    from jsonb_to_recordset(p_summaries)
      as x(stock_code text, open bigint, high bigint, low bigint, close bigint, bias smallint, volume bigint);

    insert into daily_ticks (stock_code, date, tick_index, price, is_halted, volume)
    select x.stock_code, p_tomorrow, x.tick_index, x.price, x.is_halted, x.volume
    from jsonb_to_recordset(p_ticks)
      as x(stock_code text, tick_index smallint, price bigint, is_halted boolean, volume bigint);
    get diagnostics v_ticks_inserted = row_count;
  end if;

  -- 4) 자동 뉴스 반영 (기존과 동일)
  if jsonb_array_length(p_news) > 0 then
    delete from news
      where is_auto
        and (
          (grade = 'disclosure' and date in (
            select distinct (x.date)::date from jsonb_to_recordset(p_news) as x(date text, grade text)
            where x.grade = 'disclosure'))
          or (grade in ('news', 'rumor') and date in (
            select distinct (x.date)::date from jsonb_to_recordset(p_news) as x(date text, grade text)
            where x.grade in ('news', 'rumor')))
        );
    insert into news (date, stock_code, grade, title, body, is_auto)
    select (x.date)::date, x.stock_code, x.grade, x.title, x.body, true
    from jsonb_to_recordset(p_news)
      as x(date text, stock_code text, grade text, title text, body text);
    get diagnostics v_news_inserted = row_count;
  end if;

  -- 5) 배치 실행 기록
  insert into config (key, value)
    values ('last_batch_date', to_jsonb(p_today::text))
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object(
    'settled', p_settle, 'dividendsPaid', v_dividends_paid,
    'ticksInserted', v_ticks_inserted, 'newsInserted', v_news_inserted
  );
end $$;
```

- [ ] **Step 2: 적용 + 검증**

Run: `npx supabase db reset`
Expected: 에러 없이 적용. `daily_ticks`·`daily_summary`에 volume 컬럼 존재 확인:
```bash
psql "$DATABASE_URL" -c "\d daily_ticks" | grep volume
```
Expected: `volume | bigint | not null` 표시.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716020000_volume.sql
git commit -m "feat: 틱·요약에 거래량 컬럼 추가 및 배치 반영

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B2: 거래량 생성 엔진 + 배치 주입

**Files:**
- Modify: `src/lib/engine/randomWalk.ts`(Tick.volume, DailyPath, generateDailyPath, regenerateRemainingPath)
- Modify: `src/services/batchService.ts:133-153`(summaries/ticks에 volume)
- Modify: `src/services/adminService.ts`(재생성 틱 삽입부 — grep으로 위치 특정)

**Interfaces:**
- Consumes: `Tick`(randomWalk), `daily_ticks.volume`(B1)
- Produces: `Tick { tickIndex, price, isHalted, volume }`; `generateDailyPath`가 각 틱 volume 생성; `regenerateRemainingPath` 반환 Tick에 volume.

- [ ] **Step 1: Tick/DailyPath에 volume 추가 + 생성 로직** — `src/lib/engine/randomWalk.ts`

`Tick` 인터페이스에 `volume: number;` 추가. 거래량 상수·헬퍼를 상수 블록(예: JUMP 근처)에 추가:
```typescript
// 거래량 생성 (피드백 5): baseline(등급) × (1 + k·|가격변동률|) × noise.
// 단순 변동폭 비례가 아니라 등급 baseline을 곱해 "꾸준히 활발한 대형주 vs 가끔 터지는
// 잡주"라는 독자적 정보를 만든다 → 거래량 순위가 등락 순위와 겹치지 않는다.
const VOLUME_BASELINE: Record<StockTier, number> = {
  stable: 8000, // 대형주: 꾸준히 높은 기본 유동성
  normal: 3000,
  wild: 1200, // 잡주: 평소 한산, 변동 시 스파이크
};
const VOLUME_MOVE_K = 40; // |틱 변동률|(0~)에 대한 거래량 스파이크 계수
const VOLUME_NOISE_MIN = 0.6; // noise 균등분포 [min, max]
const VOLUME_NOISE_MAX = 1.4;

// 틱 거래량: prevPrice→price 변동률과 등급 baseline로 산출. RNG 1 소비(noise).
function tickVolume(tier: StockTier, prevPrice: number, price: number, rng: Rng): number {
  const moveRate = prevPrice > 0 ? Math.abs(price - prevPrice) / prevPrice : 0;
  const noise = VOLUME_NOISE_MIN + rng() * (VOLUME_NOISE_MAX - VOLUME_NOISE_MIN);
  return Math.max(1, Math.round(VOLUME_BASELINE[tier] * (1 + VOLUME_MOVE_K * moveRate) * noise));
}
```

`generateDailyPath`의 틱 루프에서 각 틱 확정 직후 volume을 만든다. **RNG 순서 유지가 핵심** — 기존 루프 끝(가격 push) 지점에서 이전 가격 대비 변동으로 계산하되, RNG 소비가 가격 생성 뒤에 오도록 한다. `prices.push(roundPrice(price))` 뒤에 volume을 별도 배열에 모으고, 최종 `ticks` 매핑에서 사용:

```typescript
  const prices: number[] = [];
  const volumes: number[] = [];
  let price = Math.min(Math.max(prevClose * openingGapFactor(tier, rng), lowerLimit), upperLimit);
  for (let i = 0; i < totalTicks; i++) {
    const prev = i === 0 ? prevClose : prices[i - 1];
    const sigma = baseSigma * intraday[i] * h * regime.mult;
    price *= Math.exp(driftPerTick + sigma * nextGaussian(rng));
    h = clusterStep(h, Math.abs(nextGaussian(rng)) - MEAN_ABS_GAUSSIAN);
    if (rng() < jumpProbability) {
      const size = JUMP_MIN + rng() * (JUMP_MAX - JUMP_MIN);
      price *= rng() < 0.5 ? 1 + size : 1 - size;
      h = clusterBoost(h);
    }
    price = Math.min(Math.max(price, lowerLimit), upperLimit);
    const rounded = roundPrice(price);
    prices.push(rounded);
    volumes.push(tickVolume(tier, prev, rounded, rng)); // 가격 확정 후 RNG 소비
  }
```
> **주의:** `tickVolume`이 RNG를 소비하므로 이 변경은 가격 경로의 시드 재현성을 바꾼다(가격 자체는 동일 순서로 이미 소비 완료, volume은 각 틱 끝에 추가 소비). 이는 새 리허설 재생성으로 흡수된다(기존 틱과 비교 동일성 요구 없음).

`ticks` 매핑을 volume 포함으로:
```typescript
  const ticks: Tick[] = prices.map((p, i) => ({
    tickIndex: i, price: p, isHalted: halted[i], volume: volumes[i],
  }));
```
`regenerateRemainingPath`도 동일 패턴 적용: 루프에서 `volumes.push(tickVolume(tier, prev, rounded, rng))`, 반환 `ticks.push`에 `volume` 포함. (prev는 i===0이면 currentPrice.)

- [ ] **Step 2: batchService에서 volume 주입** — `src/services/batchService.ts`

`:133-148` summaries/ticks push에 volume 추가:
```typescript
      summaries.push({
        stock_code: stock.code,
        open: path.open, high: path.high, low: path.low, close: path.close,
        bias: biases[stock.code],
        volume: path.ticks.reduce((sum, t) => sum + t.volume, 0),
      });
      ticks.push(
        ...path.ticks.map((t) => ({
          stock_code: stock.code,
          tick_index: t.tickIndex,
          price: t.price,
          is_halted: t.isHalted,
          volume: t.volume,
        }))
      );
```

- [ ] **Step 3: adminService 재생성 경로 volume** — `src/services/adminService.ts`

`regenerateRemainingPath` 반환 틱을 `daily_ticks`에 반영하는 지점을 grep(`regenerateRemainingPath` 또는 `is_halted` upsert)해, 그 삽입 객체에 `volume: t.volume`을 추가한다. volume 컬럼이 NOT NULL default 0이므로 누락 시 0으로 들어가 히스토그램이 끊긴다 — 반드시 포함.

Run: `grep -n "regenerateRemainingPath\|tick_index" src/services/adminService.ts`

- [ ] **Step 4: 엔진 검증**

Run: `npm run simulate -- --runs 200`
Expected: 정상 완료(volume이 밸런스에 영향 없음 — 표시용). 빌드·린트:
Run: `npm run build && npm run lint`
Expected: 통과. `Tick` 사용처(batchService, adminService, chartService)에서 volume 누락 시 타입 에러로 잡힘.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/randomWalk.ts src/services/batchService.ts src/services/adminService.ts
git commit -m "feat: 시뮬레이션 거래량 생성 및 배치·재생성 주입

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B3: 거래량 서비스 노출 (차트·시세)

**Files:**
- Modify: `src/services/chartService.ts`(DailyCandle/IntradayPoint volume, select·매핑)
- Modify: `src/services/quoteService.ts:114-126`(volume을 시뮬 틱 누적으로), `:169`

**Interfaces:**
- Consumes: `daily_ticks.volume`, `daily_summary.volume`(B1)
- Produces: `IntradayPoint { time, price, volume }`; `DailyCandle { ..., volume }`; `StockQuote.volume` = 당일 시뮬 틱 누적(현재 틱까지).

- [ ] **Step 1: chartService volume 반환** — `src/services/chartService.ts`

`DailyCandle`에 `volume: number;`, `IntradayPoint`에 `volume: number;` 추가.
`:49` daily select에 volume: `.select("date, open, high, low, close, volume")`
`:64-70` 틱 select에 volume: `.select("tick_index, price, volume")`
`:72-75` todayPoints 매핑에 volume:
```typescript
    todayPoints = tickRows.map((t) => ({
      time: tickTimeEpoch(today, t.tick_index, hours.openHour),
      price: t.price,
      volume: t.volume,
    }));
```
`:79-81` daily 매핑에 volume: `...map((d) => ({ time: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }))`
`route.ts`(`src/app/api/stocks/[code]/chart/route.ts`)가 이 필드를 그대로 직렬화하는지 확인(대개 통과 — DTO 필터가 없으면).

- [ ] **Step 2: quoteService volume 소스 전환** — `src/services/quoteService.ts`

`:114-126`의 trades 집계 블록을, 이미 로드한 오늘 틱(`tickRows`)의 volume 누적으로 대체한다. `:93-112` 틱 조회 블록에서 volume도 함께 select하고 누적:

`:95-100` select에 volume 추가: `.select("stock_code, tick_index, price, is_halted, volume")`
`:102-112` 루프에 volume 누적 추가(sparks 옆):
```typescript
    const volumes: Record<string, number> = {};
    for (const row of tickRows) {
      (sparks[row.stock_code] ??= []).push(row.price);
      (pathByStock[row.stock_code] ??= {})[row.tick_index] = row.price;
      volumes[row.stock_code] = (volumes[row.stock_code] ?? 0) + row.volume;
      prices[row.stock_code] = { price: row.price, isHalted: row.tick_index === tickIndex && row.is_halted };
    }
```
`:114-126`의 기존 trades 집계 블록 전체 삭제. `volumes`를 tickIndex 스코프 밖에서도 쓰도록 선언 위치를 `:90` 근처(prices/sparks와 같은 스코프)로 올린다.
`:169` 그대로 `volume: Math.round(volumes[stock.code] ?? 0)`.
`src/types/domain.ts:34` `StockQuote.volume` 주석을 "당일 누적 시뮬 시장 거래량(사전 생성 틱 합)"으로 갱신.

> 인기종목(`PopularStocks`/`popularService`)은 `trades`를 별도 집계하므로 이 변경과 무관 — 실제 참가자 관심 레이어는 그대로 유지된다.

- [ ] **Step 3: 검증**

Run: `npm run build && npm run lint`
Expected: 통과.
`verify` 스킬로: 리허설 재생성 후 홈 "거래량" 정렬 시 대형주가 상위에 꾸준하고, 급등락 종목이 스파이크로 섞이는지(등락 순위와 완전 동일하지 않은지) 확인. 차트 API 응답에 volume 포함 확인.

- [ ] **Step 4: Commit**

```bash
git add src/services/chartService.ts src/services/quoteService.ts src/types/domain.ts
git commit -m "feat: 차트·시세 거래량을 시뮬 틱 누적으로 노출

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B4 + E: 차트 거래량 히스토그램 + OHLCV 툴팁 + 고저 마커

> B4(거래량 히스토그램)와 E(OHLCV 툴팁·고저 마커)는 같은 파일(`StockChart.tsx`)을 함께 고쳐 한 번에 검증하는 것이 효율적이라 하나의 태스크로 묶는다.

**Files:**
- Modify: `src/components/chart/StockChart.tsx`(ChartDto·aggregateCandles·시리즈·툴팁·마커)
- Modify: `src/components/quotes/StockStats.tsx`(거래량 라벨 의미 확인 — 표시만)

**Interfaces:**
- Consumes: `ChartData`의 `today[].volume`, `daily[].volume`(B3)
- Produces: 거래량 히스토그램 시리즈, 크로스헤어 OHLCV 오버레이, 표시 범위 최고·최저 price line.

- [ ] **Step 1: ChartDto·집계에 volume 반영** — `src/components/chart/StockChart.tsx`

`ChartDto` 타입 갱신:
```typescript
interface ChartDto {
  daily: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  today: Array<{ time: number; price: number; volume: number }>;
}
```
`IntradayCandle`에 `volume: number;` 추가. `aggregateCandles`가 volume 합산하도록:
```typescript
function aggregateCandles(points: Array<{ time: number; price: number; volume: number }>, minutes: number): IntradayCandle[] {
  const bucketSec = minutes * 60;
  const candles: IntradayCandle[] = [];
  for (const p of points) {
    const start = Math.floor(p.time / bucketSec) * bucketSec;
    const last = candles[candles.length - 1];
    if (last && last.time === start) {
      last.high = Math.max(last.high, p.price);
      last.low = Math.min(last.low, p.price);
      last.close = p.price;
      last.volume += p.volume;
    } else {
      candles.push({ time: start, open: p.price, high: p.price, low: p.price, close: p.price, volume: p.volume });
    }
  }
  return candles;
}
```

- [ ] **Step 2: 거래량 히스토그램 시리즈 추가** — `src/components/chart/StockChart.tsx`

import에 `HistogramSeries`, `createSeriesMarkers`(고저 마커용은 price line 사용 시 불필요) 추가:
```typescript
import { AreaSeries, CandlestickSeries, HistogramSeries, createChart, type IChartApi } from "lightweight-charts";
```
`chart` 생성 후, 캔들/라인 시리즈 설정 다음에 거래량 히스토그램을 별도 price scale(하단 20%)로 추가:
```typescript
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(184, 173, 163, 0.4)",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const candleData =
      mode === "daily"
        ? data.daily.map((d) => ({ time: d.time as never, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }))
        : mode === "line"
          ? []
          : aggregateCandles(data.today, MINUTES_BY_MODE[mode as "m15" | "m30" | "m60"]).map((c) => ({ ...c, time: c.time as never }));
    // 라인 모드는 틱 volume 그대로, 그 외는 봉 volume
    const volData =
      mode === "line"
        ? data.today.map((t) => ({ time: t.time as never, value: t.volume, color: "rgba(184,173,163,0.4)" }))
        : candleData.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(224,92,79,0.4)" : "rgba(91,140,201,0.4)" }));
    volSeries.setData(volData);
```
(기존 line/candle 분기에서 이미 만든 데이터를 재사용하도록 리팩터링 — 위 `candleData`를 캔들 시리즈 `setData`에도 그대로 쓴다.)

- [ ] **Step 3: 최고·최저가 price line (고저 마커)** — `src/components/chart/StockChart.tsx`

가격 시리즈(area 또는 candle)에 표시 범위의 max high / min low를 price line으로 추가:
```typescript
    const highs = mode === "daily" ? data.daily.map((d) => d.high) : mode === "line" ? data.today.map((t) => t.price) : candleData.map((c) => c.high);
    const lows = mode === "daily" ? data.daily.map((d) => d.low) : mode === "line" ? data.today.map((t) => t.price) : candleData.map((c) => c.low);
    if (highs.length) {
      priceSeries.createPriceLine({ price: Math.max(...highs), color: "rgba(224,92,79,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "고" });
      priceSeries.createPriceLine({ price: Math.min(...lows), color: "rgba(91,140,201,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "저" });
    }
```
(`priceSeries`는 현재 `series` 변수 — line/candle 분기에서 만든 가격 시리즈 참조를 상위 스코프 변수로 올린다.)

- [ ] **Step 4: 크로스헤어 OHLCV 툴팁 오버레이** — `src/components/chart/StockChart.tsx`

컨테이너를 `relative`로 감싸고, hover 값을 담을 state + 오버레이 div 추가. `chart.subscribeCrosshairMove`로 hover 시점의 봉 데이터를 찾아 표시:
```typescript
  const [hover, setHover] = useState<{ o?: number; h?: number; l?: number; c: number; v: number } | null>(null);
```
useEffect 안, 시리즈 setData 뒤에:
```typescript
    const byTime = new Map<number, { o?: number; h?: number; l?: number; c: number; v: number }>();
    if (mode === "line") {
      data.today.forEach((t) => byTime.set(t.time, { c: t.price, v: t.volume }));
    } else {
      candleData.forEach((c) => byTime.set(c.time as unknown as number, { o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
    }
    chart.subscribeCrosshairMove((param) => {
      const t = param.time as unknown as number;
      setHover(param.time != null && byTime.has(t) ? byTime.get(t)! : null);
    });
```
JSX에서 차트 컨테이너를 감싸 오버레이 표시:
```tsx
        <div className="relative">
          <div ref={containerRef} className={todayEmpty || isLoading ? "hidden" : ""} />
          {hover && (
            <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-background/90 px-2 py-1 text-xs tabular-nums shadow">
              {hover.o != null && <span>시 {formatMoney(hover.o)} · 고 {formatMoney(hover.h!)} · 저 {formatMoney(hover.l!)} · 종 {formatMoney(hover.c)} · </span>}
              {hover.o == null && <span>가 {formatMoney(hover.c)} · </span>}
              거래량 {hover.v.toLocaleString()}
            </div>
          )}
        </div>
```
import에 `formatMoney` 추가: `import { formatMoney } from "@/lib/market";`. `hover` state는 `mode` 변경 시 초기화되도록 effect cleanup에서 `setHover(null)`.

- [ ] **Step 5: StockStats 거래량 라벨 확인** — `src/components/quotes/StockStats.tsx`

`:31`의 거래량 표시가 이제 시뮬 시장 거래량(quote.volume)을 그대로 쓰는지 확인. 라벨은 "거래량"으로 유지(변경 불필요할 가능성 높음). 실제 참가자 체결과 혼동 소지가 있으면 라벨을 "거래량"으로 두고 인기종목과 구분(코드 변경 없이 확인만).

- [ ] **Step 6: 실앱 검증**

Run: `npm run build && npm run lint`
그다음 `verify` 스킬로: 종목 상세 차트에서
1. 캔들 하단에 거래량 히스토그램이 뜨는지
2. 봉에 마우스 올리면 시/고/저/종/거래량 오버레이가 뜨는지(15분·30분·일봉)
3. 고·저 점선 라벨이 뜨는지
확인.

- [ ] **Step 7: Commit**

```bash
git add src/components/chart/StockChart.tsx src/components/quotes/StockStats.tsx
git commit -m "feat: 차트 거래량 히스토그램·OHLCV 툴팁·고저 마커 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task C1: watchlists 테이블 + 토글 RPC

**Files:**
- Create: `supabase/migrations/20260716030000_watchlist.sql`

**Interfaces:**
- Produces: `watchlists(user_id bigint, stock_code text, created_at timestamptz)`; `toggle_watchlist(p_user_id bigint, p_stock_code text) returns boolean`(true=등록됨/false=해제됨).

- [ ] **Step 1: 마이그레이션 작성** — `supabase/migrations/20260716030000_watchlist.sql`

```sql
-- 관심종목 (피드백 1) — 로그인 계정 귀속. 접근은 service-role 서비스 경유(RLS 차단 관례).
create table if not exists watchlists (
  user_id bigint not null references users(id) on delete cascade,
  stock_code text not null references stocks(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, stock_code)
);
alter table watchlists enable row level security; -- 정책 없음 = 클라이언트 직접접근 차단

-- 토글: 있으면 삭제(false), 없으면 삽입(true). 최종 등록 상태 반환.
create or replace function toggle_watchlist(p_user_id bigint, p_stock_code text)
returns boolean language plpgsql as $$
declare v_exists boolean;
begin
  delete from watchlists where user_id = p_user_id and stock_code = p_stock_code;
  if found then
    return false;
  end if;
  insert into watchlists (user_id, stock_code) values (p_user_id, p_stock_code);
  return true;
end $$;
```

- [ ] **Step 2: 적용 검증**

Run: `npx supabase db reset`
Expected: 적용 성공. SQL로 토글 왕복 확인:
```bash
psql "$DATABASE_URL" -c "select toggle_watchlist((select id from users limit 1), 'MLVD');"  # true
psql "$DATABASE_URL" -c "select toggle_watchlist((select id from users limit 1), 'MLVD');"  # false
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716030000_watchlist.sql
git commit -m "feat: 관심종목 테이블 및 토글 함수 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task C2: 관심종목 서비스 + API

**Files:**
- Create: `src/services/watchlistService.ts`
- Create: `src/app/api/watchlist/route.ts`

**Interfaces:**
- Consumes: `toggle_watchlist` RPC(C1), 세션 유틸(`src/lib/auth/*` — 기존 API route에서 쓰는 현재 유저 조회 방식을 그대로 따른다)
- Produces: `getWatchlist(userId): Promise<string[]>`; `toggleWatchlist(userId, stockCode): Promise<boolean>`; `GET /api/watchlist` → `{ codes: string[] }`; `POST /api/watchlist` body `{ stockCode }` → `{ watching: boolean }`.

- [ ] **Step 1: 서비스 작성** — `src/services/watchlistService.ts`

```typescript
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// 내 관심종목 코드 목록
export async function getWatchlist(userId: number): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("watchlists")
    .select("stock_code")
    .eq("user_id", userId);
  if (error) throw error;
  return data.map((r) => r.stock_code);
}

// 토글 후 최종 등록 상태 반환 (true=등록됨)
export async function toggleWatchlist(userId: number, stockCode: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("toggle_watchlist", {
    p_user_id: userId,
    p_stock_code: stockCode,
  });
  if (error) throw error;
  return data as boolean;
}
```

- [ ] **Step 2: API route 작성** — `src/app/api/watchlist/route.ts`

기존 인증 route(예: `src/app/api/portfolio/route.ts`)를 열어 현재 유저 세션을 얻는 방식과 `ApiResponse<T>` 래퍼 사용법을 그대로 따른다. 그 패턴에 맞춰:

```typescript
import { NextRequest } from "next/server";
// 아래 두 import는 기존 인증 route의 방식에 맞춘다 (getCurrentUser·ok·fail 등)
import { getCurrentUser } from "@/lib/auth/session"; // 실제 경로·함수명은 기존 route에서 확인
import { ok, fail } from "@/lib/api/response"; // 실제 래퍼는 기존 route에서 확인
import { getWatchlist, toggleWatchlist } from "@/services/watchlistService";
import { z } from "zod";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  const codes = await getWatchlist(user.id);
  return ok({ codes });
}

const bodySchema = z.object({ stockCode: z.string().min(1) });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return fail("VALIDATION", 400);
  const watching = await toggleWatchlist(user.id, parsed.data.stockCode);
  return ok({ watching });
}
```
> 구현자 주의: `getCurrentUser`/`ok`/`fail`/`ApiResponse` 실제 심볼은 `src/app/api/portfolio/route.ts`(또는 다른 인증 route)를 열어 동일 패턴으로 맞춘다. 위는 형태 예시.

- [ ] **Step 3: 검증**

Run: `npm run build && npm run lint`
그다음 `verify`(로그인 상태)로 `GET /api/watchlist` → `{ codes: [] }`, `POST {stockCode:"MLVD"}` → `{ watching: true }` 왕복 확인.

- [ ] **Step 4: Commit**

```bash
git add src/services/watchlistService.ts src/app/api/watchlist/
git commit -m "feat: 관심종목 서비스 및 API 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task C3: 관심종목 훅 + 별 토글 + 전체/관심 탭

**Files:**
- Create: `src/hooks/useWatchlist.ts`
- Modify: `src/app/page.tsx`(전체/관심 탭 + 별 토글), `src/app/stocks/[code]/page.tsx`(별 토글)

**Interfaces:**
- Consumes: `GET/POST /api/watchlist`(C2)
- Produces: `useWatchlist()` → `{ codes: Set<string>, toggle(code): void, isWatching(code): boolean }`.

- [ ] **Step 1: 훅 작성** — `src/hooks/useWatchlist.ts`

```typescript
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, postJson } from "@/lib/api/client";

// 관심종목 조회 + 낙관적 토글. 비로그인이면 codes 빈 셋(쿼리 실패 무시).
export function useWatchlist() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => getJson<{ codes: string[] }>("/api/watchlist"),
    retry: false,
  });
  const codes = new Set(data?.codes ?? []);

  const mutation = useMutation({
    mutationFn: (code: string) => postJson<{ watching: boolean }>("/api/watchlist", { stockCode: code }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  return {
    codes,
    isWatching: (code: string) => codes.has(code),
    toggle: (code: string) => mutation.mutate(code),
  };
}
```

- [ ] **Step 2: 시세판 전체/관심 탭 + 별 토글** — `src/app/page.tsx`

import: `import { Star } from "lucide-react";`(개별 임포트), `import { useWatchlist } from "@/hooks/useWatchlist";`.
`Home`에 탭 state와 필터 추가:
```tsx
  const [tab, setTab] = useState<"all" | "watch">("all");
  const watchlist = useWatchlist();
  const base = data ? sortQuotes(data.quotes, sort) : undefined;
  const quotes = base?.filter((q) => tab === "all" || watchlist.isWatching(q.code));
```
정렬 옵션 줄 위에 전체/관심 탭 버튼 2개 추가(기존 SORT 버튼과 동일 스타일):
```tsx
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => setTab("all")}
          className={cn("h-7 px-2 text-xs", tab === "all" ? "bg-muted text-foreground" : "text-muted-foreground")}>전체</Button>
        <Button variant="ghost" size="sm" onClick={() => setTab("watch")}
          className={cn("h-7 px-2 text-xs", tab === "watch" ? "bg-muted text-foreground" : "text-muted-foreground")}>관심</Button>
      </div>
```
`QuoteRow`에 별 버튼 추가 — Link 밖에서 클릭이 링크로 전파되지 않도록 별도 버튼으로 감싼다. `QuoteRow`에 `watching`, `onToggle` props를 받아 종목명 좌측에 별 아이콘 버튼 배치:
```tsx
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onToggle(); }}
          className="p-1"
          aria-label={watching ? "관심 해제" : "관심 등록"}
        >
          <Star className={cn("h-4 w-4", watching ? "fill-primary-accent text-primary-accent" : "text-muted-foreground")} />
        </button>
```
`quotes?.map`에서 `<QuoteRow ... watching={watchlist.isWatching(q.code)} onToggle={() => watchlist.toggle(q.code)} />`.
관심 탭이 비었을 때 안내(로그인 유도 포함):
```tsx
      {tab === "watch" && quotes?.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">관심 등록한 종목이 없습니다. 별을 눌러 등록하세요.</p>
      )}
```

- [ ] **Step 3: 종목 상세 별 토글** — `src/app/stocks/[code]/page.tsx`

`"use client"` 컴포넌트라면 `useWatchlist`를 직접 쓰고, Server Component면 별 토글을 담은 작은 `"use client"` 하위 컴포넌트(`WatchToggle`)를 만들어 헤더에 배치. 종목명 헤더 옆에 Step 2와 동일한 Star 버튼을 둔다.

- [ ] **Step 4: 실앱 검증**

Run: `npm run build && npm run lint`
`verify`(로그인)로: 시세판에서 별 클릭 → 채워짐, "관심" 탭 전환 시 그 종목만 표시, 다시 클릭 시 해제·목록에서 사라짐. 비로그인 시 관심 탭 안내 노출.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWatchlist.ts src/app/page.tsx src/app/stocks/
git commit -m "feat: 관심종목 별 토글 및 시세판 전체/관심 탭

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D1: 매수 정수 수량 허용 (RPC)

**Files:**
- Create: `supabase/migrations/20260716040000_buy_quantity.sql`

**Interfaces:**
- Consumes: 기존 `execute_trade` 정의(`20260714040000_fractional_shares.sql`)
- Produces: `execute_trade`가 매수에서 `p_quantity`(정수) 허용. 매수 수량 지정 시 `p_quantity`는 정수여야 하고, 필요 금액 = `round(p_quantity × price) ≤ 잔고`.

- [ ] **Step 1: 마이그레이션 작성** — `supabase/migrations/20260716040000_buy_quantity.sql`

`20260714040000_fractional_shares.sql`의 `execute_trade` 전체를 복사하되, 매수 제약을 (a) `buy + p_amount is null`(=수량 매수) 시 정수 검증으로 바꾼다. 시그니처 동일(`CREATE OR REPLACE`).

핵심 변경은 딱 두 곳:
1. `:58-61`의 매수 금액 강제 raise 삭제.
2. 그 자리에 매수 수량 정수 검증 추가:
```sql
  -- 매수 수량 지정 시 정수만 허용 (금액 지정은 소수점 주식 파생 — 기존 유지)
  if p_side = 'buy' and p_quantity is not null and p_quantity <> trunc(p_quantity) then
    raise exception 'VALIDATION';
  end if;
```
나머지 로직(`:117-121`의 amount→qty / else quantity→qty, `:130-154`의 매수 잔고 검증·평단 갱신)은 그대로 두면 수량 매수가 자연히 동작한다(`p_quantity` 경로가 이미 존재). 마이그레이션 파일에는 함수 전체를 담되 위 두 변경만 반영.

전체 함수 본문은 `20260714040000_fractional_shares.sql:21-200`을 그대로 복사하고, `:58-61`을 위 Step 1의 정수 검증 블록으로 치환한 형태다.

- [ ] **Step 2: 적용 + SQL 직접 검증**

Run: `npx supabase db reset`
그다음 매수 수량 경로를 SQL로 검증(`p_at`으로 장중 시각 오버라이드):
```bash
# 정수 3주 매수 (장중 시각으로)
psql "$DATABASE_URL" -c "select execute_trade((select id from users limit 1), 'OKCC', 'buy', 3, null, '2026-08-01T15:30:00+09:00');"
# 소수점 수량 매수는 거부돼야 함 (VALIDATION)
psql "$DATABASE_URL" -c "select execute_trade((select id from users limit 1), 'OKCC', 'buy', 1.5, null, '2026-08-01T15:30:00+09:00');"
```
Expected: 첫 번째는 체결 JSON(quantity=3), 두 번째는 `VALIDATION` 에러.
(틱 데이터가 있는 날짜·시각으로 조정. 리허설 부트스트랩 필요 시 배치 먼저.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716040000_buy_quantity.sql
git commit -m "feat: 매수 정수 수량 지정 허용

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D2: 매수 수량 검증 스키마 + BuyDialog 토글

**Files:**
- Modify: `src/lib/validation/trade.ts`
- Modify: `src/components/trade/TradePanel.tsx:302-425`(BuyDialog)

**Interfaces:**
- Consumes: `execute_trade` 매수 수량(D1), 기존 `TradePayload`
- Produces: 매수 시 `{ quantity: 정수 }` 페이로드 허용; BuyDialog 금액/수량 토글.

- [ ] **Step 1: 검증 스키마 — 매수 수량 정수** — `src/lib/validation/trade.ts`

`quantity` 필드에 정수 제약은 매수만 필요하나 서버가 최종 검증하므로, 스키마는 quantity가 정수여도 통과하도록 두되(매도 소수점도 허용 유지) UI가 매수에서 정수만 보내게 한다. 주석만 갱신:
```typescript
    // 수량 지정 (매도 수량모드 = 소수점 허용 / 매수 수량모드 = 정수, UI에서 보장·서버 재검증)
    quantity: z
      .number()
      .positive("수량은 0보다 커야 합니다")
      .max(1_000_000, "수량이 너무 큽니다")
      .optional(),
```
(refine 로직은 그대로 — amount·quantity 정확히 하나.)

- [ ] **Step 2: BuyDialog 금액/수량 토글** — `src/components/trade/TradePanel.tsx`

SellDialog의 `mode` 토글 패턴을 BuyDialog에 이식한다. BuyDialog에 `mode` state 추가:
```tsx
  const [mode, setMode] = useState<"amount" | "qty">("amount");
```
수량·금액 파생값 계산(시장가일 때만 수량 모드; 지정가는 기존 금액 유지):
```tsx
  const qtyInput = Math.floor(Number(amountText) || 0); // 수량 모드에서 정수
  const buyQty = isLimit || mode === "amount" ? quantity : qtyInput;
  const buyAmount = isLimit || mode === "amount" ? amount : Math.round(qtyInput * quote.price);
```
`valid`를 모드별로:
```tsx
  const valid =
    isLimit
      ? amount >= 1 && amount <= availableCash && bandOk
      : mode === "amount"
        ? amount >= 1 && amount <= availableCash
        : qtyInput >= 1 && Math.round(qtyInput * quote.price) <= availableCash;
```
`onSubmit`에서 수량 모드는 quantity 페이로드로:
```tsx
  function onSubmit() {
    if (!valid) return;
    if (isLimit) { order.submit({ limitPrice, amount }, reset); return; }
    if (mode === "qty") market.submit({ quantity: qtyInput }, qtyInput, () => setAmountText(""));
    else market.submit({ amount }, quantity, () => setAmountText(""));
  }
```
시장가일 때만 금액/수량 토글 UI 추가(OrderTypeTabs 아래, LimitPriceInput 자리 근처 — SellDialog `:514-539` 구조 복제, 라벨 "금액"/"수량"). 수량 모드에서 Input `placeholder`를 "수량 (주)"로, `inputMode="numeric"`, `step="1"`. 칩(BUY_CHIPS)은 금액 모드에서만 노출하거나 수량 모드에선 "+1/+5/+10주 · 최대(floor(잔고/현재가))"로 대체:
```tsx
  const maxBuyQty = quote.price > 0 ? Math.floor(availableCash / quote.price) : 0;
```
예상값 카드는 모드에 따라 "예상 수량 {buyQty}주 / 주문 금액 {buyAmount}"를 표시. 확인 버튼 라벨도 수량 모드는 `${qtyInput}주 구매 확인`.

> 핵심: 수량 모드에서 서버로 보내는 페이로드는 `{ quantity: 정수 }`뿐. 금액 모드·지정가는 기존과 100% 동일하게 유지.

- [ ] **Step 3: 실앱 검증**

Run: `npm run build && npm run lint`
`verify`(로그인)로: 구매 다이얼로그에서 "수량" 탭 → 3 입력 → "3주 구매 확인" → 체결. "금액" 탭은 기존대로. 잔고 초과 수량은 버튼 비활성.

- [ ] **Step 4: Commit**

```bash
git add src/lib/validation/trade.ts src/components/trade/TradePanel.tsx
git commit -m "feat: 매수 다이얼로그 금액/수량 입력 토글

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 실행 순서 & 최종 검증

권장 순서: **A1 → A2 → A3 → B1 → B2 → B3 → B4+E → C1 → C2 → C3 → D1 → D2**.
- A·B는 DB/엔진 변경 → 완료 후 어드민 콘솔 "리허설 데이터 초기화"로 재생성.
- B4+E는 B3(volume 노출)에 의존.
- C·D는 A·B와 독립(병렬 가능).

**전체 완료 후 최종 검증:**
- [ ] `npm run build && npm run lint` 통과
- [ ] `npm run simulate -- --runs 500` 밸런스 유지(섹터 편향이 추종 지배를 만들지 않음)
- [ ] 리허설 재생성 후 `verify` 스킬로 6개 피드백 각각 실앱 확인:
  1. 시세판 전체/관심 탭 + 별 토글
  2. 구매 다이얼로그 수량 탭 체결
  3. 시세판·상세 섹터 라벨 + 섹터 뉴스 생성
  4. 차트 봉 hover 시 고/저 + 고저 마커
  5. 시세판 거래량 정렬(대형주 상위·잡주 스파이크) + 차트 히스토그램
  6. 봉 hover OHLCV(시/고/저/종/거래량) 툴팁
- [ ] ROADMAP 체크박스·진행률 갱신
- [ ] `finishing-a-development-branch` 스킬로 PR/머지 진행

## 범위 밖 (스펙 미결)
- 호가창(사전 생성 모델에선 눈속임 — 보류)
- 지정가 수량 매수(`place_limit_order` — 이번 범위 밖)

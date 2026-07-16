# 시세·거래 피드백 6종 구현 설계

- 작성일: 2026-07-16
- 상태: 승인 대기 (스펙 리뷰 단계)
- 관련 피드백: 손님/운영 피드백 6항목 (관심종목 · 수량 매수 · 섹터 · 봉 고저 · 거래량 · 봉 OHLCV)

## 배경

현행 아키텍처 핵심 제약(위반 금지):

- **가격은 사전 생성 경로.** 폐장 배치가 익일 전체 틱을 클라이언트 엔진(`src/lib/engine/*`, `src/lib/news/generate.ts`)에서 생성해 `apply_daily_batch()`에 jsonb로 넘겨 `daily_ticks`/`daily_summary`에 저장한다. 장중엔 읽기만 한다.
- **모든 돈 계산은 서버 Postgres 함수 단일 트랜잭션.** 클라이언트가 보낸 가격·잔고·수량은 신뢰하지 않는다.
- **자산은 정수(원).** 수량은 `numeric(20,6)` 소수점 주식.

이 스펙은 위 제약을 유지하며 6개 피드백을 구현한다. 6개는 상당히 독립적이므로 각 항목을 독립 작업 단위로 기술하고, DB/엔진을 건드리는 A·B를 먼저 배치한다.

---

## A. 섹터 분류 + 뉴스 연동 (피드백 3)

### 목표
종목을 `tier`(우량/일반/테마)와 **직교하는** 섹터 축으로 분류하고, 뉴스가 섹터 단위로도 작동하게 한다.

### DB
- `stocks`에 `sector text` 컬럼 추가 (마이그레이션 신규). NOT NULL + 기본값 없이 각 종목에 명시 지정.
- 27종(`supabase/migrations/20260714000000_roster_27.sql` 소스)에 섹터 매핑 부여. 섹터 셋(잠정, 세계관 캐논 준수):
  전기전자·반도체 / 방산 / IT서비스 / 바이오·제약 / 에너지·소재 / 유통·소비재 / 금융. (최종 종목별 배정은 구현 계획에서 확정.)
- `sector`는 표시·필터·뉴스 타겟팅용. 지수 분류(NASPI/NASDAK)는 기존 `tier` 파생 그대로 유지.

### 엔진/배치 (뉴스 연동)
- 익일 편향 추첨 단계(가격 엔진 편향 생성부)에 **섹터 이벤트**를 추가:
  - 하루 확률적으로 섹터 1개 선정 → 그 섹터 전 상장 종목에 **공통 방향 편향**을 개별 편향에 가산.
  - 섹터 단위 뉴스 1건 생성(`stock_code = null` 허용됨 — `NewsItem`/배치가 이미 nullable) — "○○ 업종 전반 강세/약세" 톤. 등급은 정식뉴스(`news`), 노출 타이밍은 기존 정식뉴스 정책(장 후반 사후 설명) 준수 → 섹터 추종도 이득 없게 유지.
  - 개별 종목 편향/뉴스는 기존대로 병존. 섹터 편향은 개별 위에 덧대는 레이어.
- 밸런스: 섹터 편향 세기·발생 빈도는 `npm run simulate`로 검증(추종 지배 전략화 방지 — 기존 EARLY_SIGNAL 검증 철학 준용).

### 프론트
- 시세판 종목 행(`src/app/page.tsx` `QuoteRow`)·종목 상세(`src/app/stocks/[code]/page.tsx`)에 섹터 뱃지.
- 뉴스 피드에서 섹터 뉴스는 종목 링크 대신 섹터 라벨 표기.

### 영향 파일
`supabase/migrations/*`(신규), `src/lib/engine/*`(편향 생성), `src/lib/news/generate.ts`, `src/types/domain.ts`(Stock/StockQuote에 `sector`), `src/services/quoteService.ts`, `src/app/page.tsx`, `src/app/stocks/[code]/page.tsx`.

---

## B. 시뮬레이션 거래량 (피드백 5, 6-V)

### 확정 방침
- **홈/시세판 거래량 순위·차트 히스토그램 = 시뮬레이션 거래량** (시장 활동성 연출).
- **실제 참가자 관심 = 인기종목 위젯**(`PopularStocks`, 실제 `trades` 익명 집계) — 기존 그대로 유지. 역할 분리.
- 시뮬 거래량은 참가자 행동과 무관한 연출이지만, 가격이 사전 생성이라 추종해도 이득이 없어 공정성 리스크 없음.

### 거래량 생성 공식 (등락 순위와 차별화)
단순 변동폭 비례 금지(거래량 순위 ≈ 등락 순위가 되어 정보 중복). 다음 3요소 합성:

```
tick_volume = baseline(tier/시총) × (1 + k·|가격변동률|) × noise
```

- **baseline**: 종목별 기본 유동성. 우량주(대형)는 높고 테마주는 낮게 — 시총(`shares_outstanding` × 가격) 또는 tier 기반. "꾸준히 활발한 대형주" 성격 부여.
- **변동 스파이크**: 그 틱의 가격 변동률에 비례한 가산 — "가끔 터지는 잡주" 성격.
- **noise**: 엔진 rng 기반 랜덤(가격과 동일 시드 경로, 결정론 유지).

결과: 거래량 순위가 등락 순위와 겹치지 않고 독자적 정보를 가진다. 정수 주 수로 라운딩.

### DB
- `daily_ticks`에 `volume bigint not null default 0` 추가.
- `daily_summary`에 `volume bigint not null default 0` 추가. 요약 volume = 당일 틱 volume 합.
- 배치(`apply_daily_batch`)의 요약 산출부(`20260712010000_daily_batch.sql`)·틱 삽입부(`20260712030000_news_batch.sql`)에 volume 반영.

### 서버/서비스
- 차트 서비스(`src/services/chartService.ts`)가 틱 volume·요약 volume을 함께 반환.
- 시세 서비스(`src/services/quoteService.ts`): 현재 `trades` 런타임 집계 대신, 시세판 표시 거래량은 **당일 틱 누적 시뮬 volume**(현재 시각까지)로 산출. (실제 체결 집계는 인기종목 경로에 잔존.)
- `StockQuote.volume` 의미를 "시뮬 시장 거래량"으로 재정의(도메인 타입 주석 갱신).

### 프론트
- 시세판 리스트에 **거래량 컬럼** 상시 표시(현재는 정렬 기준으로만 존재).
- 홈 화면 거래량 순위 노출(정렬 옵션 `volume` 유지 — 이제 시뮬 기반이라 항상 유의미).
- 차트(`src/components/chart/StockChart.tsx`)에 **거래량 히스토그램 시리즈** 추가(캔들 하단).

### 영향 파일
`supabase/migrations/*`(신규), 배치 마이그레이션 2건, `src/lib/engine/*`(volume 생성), `src/services/chartService.ts`, `src/services/quoteService.ts`, `src/types/domain.ts`, `src/app/page.tsx`, `src/components/chart/StockChart.tsx`, `src/components/quotes/StockStats.tsx`.

### 주의
- DB 스키마·엔진 변경이므로 **리허설 데이터 재생성** 필요(기존 리허설 초기화 절차 준용).
- 기존 `daily_ticks`/`daily_summary`에 volume 없는 과거 데이터는 default 0 → 재생성 전까지 히스토그램 빈 구간 가능(리허설에서 재생성으로 해소).

---

## C. 관심종목 (피드백 1)

### 목표
로그인 계정에 귀속되는 관심종목. 시세판에 "전체 / 관심" 탭.

### DB
- 신규 테이블 `watchlists(user_id bigint, stock_code text, created_at timestamptz default now(), primary key(user_id, stock_code))`.
  FK: `user_id → users`, `stock_code → stocks`. RLS는 프로젝트 관례(service-role only)대로 차단, 접근은 서비스 경유.
- 토글 RPC `toggle_watchlist(p_user_id bigint, p_stock_code text) returns boolean`(있으면 삭제/없으면 삽입, 최종 상태 반환). 조회는 서비스에서 select.

### API
- `src/app/api/watchlist/route.ts`: `GET`(내 관심 목록), `POST`(토글). 인증은 기존 세션 유틸(`src/lib/auth/*`) 재사용.
- 서비스 `src/services/watchlistService.ts`.

### 프론트
- 종목 행·상세에 별(관심) 토글 버튼. 낙관적 업데이트(TanStack Query mutation).
- 시세판 상단 **"전체 / 관심" 탭** — 관심 탭은 내 `watchlists`에 든 종목만 필터링(클라이언트 필터, 목록은 기존 `useQuotes` 재사용 + 관심 코드 셋 교집합).
- 비로그인 시 관심 탭/버튼은 로그인 유도.

### 영향 파일
`supabase/migrations/*`(신규 테이블 + RPC), `src/app/api/watchlist/route.ts`(신규), `src/services/watchlistService.ts`(신규), `src/hooks/*`(useWatchlist 신규), `src/app/page.tsx`, `src/components/quotes/*` 또는 `src/app/stocks/[code]/*`.

---

## D. 수량 매수 (피드백 2)

### 목표
금액 입력 외에 **정수 수량**으로 매수. 체결가는 서버 틱 값.

### RPC
- `execute_trade`(`supabase/migrations/20260714040000_fractional_shares.sql` 소스) 수정:
  - 매수에서 `p_quantity`도 허용. 현행 `p_side='buy' and p_amount is null` → `VALIDATION` raise를 완화: 매수는 `p_amount`와 `p_quantity` 중 **정확히 하나** 요구.
  - 수량 매수 시: 수량은 정수 검증(`p_quantity = trunc(p_quantity)`), 체결가 = 현재 KST 틱 값, 필요 금액 = `p_quantity × price`, `필요 금액 ≤ 잔고` 검증 후 체결. 매도 수수료 로직은 매수 무관(기존 유지).
  - 함수 시그니처는 유지(`p_quantity numeric` 이미 존재) — 내부 분기만 수정. (지정가 `place_limit_order`는 이번 범위 밖, 기존 유지.)

### 검증/서비스
- `src/lib/validation/trade.ts` `tradeSchema`: 매수도 `quantity`(정수, 양수) 경로 허용. `amount`·`quantity` 정확히 하나 유지.
- `src/services/tradeService.ts`: 파라미터 전달만.

### UI
- `BuyDialog`(`src/components/trade/TradePanel.tsx:305-425`)에 **금액/수량 토글** 추가(매도 `SellDialog`의 토글 패턴 재사용, line 514-539 참고).
  - 수량 탭: 정수 스텝퍼/입력, 예상 체결 금액(`수량 × 현재가`) 표시, "최대" = `floor(잔고 / 현재가)`.
  - 금액 탭: 기존 그대로.

### 영향 파일
`supabase/migrations/*`(신규 — execute_trade 재정의), `src/lib/validation/trade.ts`, `src/services/tradeService.ts`, `src/app/api/trade/route.ts`, `src/components/trade/TradePanel.tsx`.

---

## E. 봉 고가/저가 + OHLCV 툴팁 (피드백 4, 6)

### 목표
일봉·15분·30분·60분 봉 hover 시 시가/고가/저가/종가/거래량을 보고, 현재 범위 최고·최저가를 라벨로 확인.

### 프론트 (차트만)
- `StockChart.tsx`:
  - **크로스헤어 툴팁 오버레이**: `subscribeCrosshairMove`로 hover 봉의 O/H/L/C + Volume(B에서 추가)을 카드로 표시. 라인 모드는 가격·거래량만.
  - **최고·최저가 마커**: 현재 표시 범위의 max high / min low 지점에 price line 또는 마커 라벨.
  - 분봉 집계 `aggregateCandles`(line 48-66)에 **volume 합산** 추가(틱 volume → 봉 volume).
  - 일봉은 `daily_summary.volume`(B) 사용.

### 영향 파일
`src/components/chart/StockChart.tsx`(툴팁·마커·volume 집계), `src/services/chartService.ts`(volume 필드 — B와 공유), `src/types/domain.ts`(IntradayPoint/DailyCandle에 volume).

---

## 구현 순서

DB·엔진을 건드려 리허설 재생성이 필요한 A·B를 먼저, 이후 독립적인 C·D·E.

1. **A. 섹터 + 뉴스 연동** — 데이터 기반, 시드/엔진/뉴스. 밸런스 시뮬 검증.
2. **B. 시뮬레이션 거래량** — DB 컬럼 + 엔진 volume 생성 + 배치 반영. 리허설 재생성.
3. **C. 관심종목** — 신규 테이블/RPC/API/탭. (A·B와 무관, 병렬 가능)
4. **D. 수량 매수** — execute_trade 수정 + BuyDialog 토글.
5. **E. 차트 OHLCV 툴팁·고저 라벨** — B의 volume에 의존(툴팁 V 표시).

각 항목은 `npm run build` + `npm run lint` 통과, `verify` 스킬(dev + agent-browser)로 실앱 검증, ROADMAP 갱신 후 커밋.

## 미결/후속 (범위 밖)

- 호가창: 사전 생성 모델에선 눈속임이라 계속 **보류**.
- 지정가 수량 매수(`place_limit_order`): 이번 범위 밖.
- 섹터별 종목 최종 배정표: 구현 계획에서 세계관 캐논(`naraka-lore-canon`) 준수해 확정.

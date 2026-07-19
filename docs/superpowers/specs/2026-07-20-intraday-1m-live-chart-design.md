# 10초 틱 이점 살리기 — 실시간 라인 + 1분봉

- 작성일: 2026-07-20
- 상태: 승인됨 (구현 대기)
- 관련: [10초 틱 전환](2026-07-19-10s-tick-live-pricing-design.md), [멀티데이 장중 차트](2026-07-18-chart-multiday-intraday-design.md)

## 배경 — 이점이 절반만 실현돼 있다

10초 틱 전환(PR#53)은 **데이터 레이어**만 바꿨고, 사용자 체감은 영역별로 갈린다.

| 영역 | 상태 | 10초 이점 |
|------|------|:---:|
| 시세판/현재가 (`useQuotes`) | 10초 틱 경계마다 폴링(`msUntilNextTick`) | ✅ 살아있음 |
| 차트 봉 (`daily_candles`) | 여전히 5분 OHLC(30틱=1버킷) | ❌ 5분 세계 |
| 차트 오늘 라인 (`chartService`) | 5분 캔들 close 점으로만 그림 → 10초 디테일 폐기 | ❌ 5분 세계 |
| 차트 폴링 (`StockChart`) | `refetchInterval: 5 * 60_000` (주석 "틱 주기와 동일"은 stale) | ❌ 5분마다 |

현재가는 10초마다 살아 움직이는데, **메인 비주얼인 차트는 5분에 한 번 뚝뚝 끊겨 갱신**된다. "요괴 주식이 실시간으로 요동친다"는 몰입감의 상당 부분이 차트에서 죽어 있다.

## 목표

장중 차트를 5분 세계 → 실시간/1분 세계로. 시세판처럼 차트도 살아 움직이게 해 몰입감을 회복한다. 두 축으로 나뉜다.

## 축 1 — 실시간 라인 (접근 2: 10초 tip)

- **과거 구간**: 1분봉 close 라인 (완료된 버킷만, 기존 미래유출 게이팅 유지)
- **tip(맨 앞 점)**: `useQuotes`가 이미 제공하는 10초 현재가를 이 종목에 대해 찾아 라인 끝에 append → 10초마다 살아 움직임
- **이중 폴링**:
  - 차트 자체 fetch(`getChartData`) = 1분 주기 (완료된 1분봉 갱신)
  - tip = `useQuotes` 재사용 = 10초 주기. lightweight-charts `series.update()`로 마지막 점만 갱신

### 왜 접근 2인가 (대안 대비)

- **접근 1(1분 단위로만 통일)**: 완료된 1분봉만, 1분 폴링. 단순·안전하나 라인 끝이 최대 1분 뒤처짐.
- **접근 2(채택)**: 과거는 1분봉, tip만 10초 현재가. 현재가는 `getTickIndex`가 현재 틱으로 클램프하는 **미래유출이 원천 차단된 검증 경로**라, 새 유출면 없이 10초 실시간 체감을 얻는다.
- **접근 3(부분버킷 실시간 집계)**: 완전 실시간이나 raw 틱 조회 부활 + 게이팅 버킷 내부 재설계 → 오버엔지니어링, 폐기.

## 축 2 — 1분봉 (기본 해상도 5분 → 1분)

현재 서버 최소 해상도는 5분봉(`m5`)이고 m15/m30/m60은 클라이언트가 5분봉을 묶어 재집계한다. 1분봉 소스 자체가 없으므로 기본 해상도를 내린다.

- `daily_candles` 버킷을 30틱(5분) → **6틱(1분)**, bucket 0~719
- 토글에 **`m1`(1분)** 추가. m5/m15/m30/m60은 1분봉을 N개씩 묶어 재집계(기존 client 로직 그대로, m5도 client 집계로 전환)
- 1분봉 페이로드는 **최근 3일치**만 (720×3 ≈ 2,160행/종목). 전체 추세는 일봉(daily)이 담당

## 변경 지점

### 데이터/배치
- `src/lib/market.ts`: `CANDLE_INTERVAL_MINUTES` 5→1, `TICKS_PER_CANDLE` 30→6
  - `bucketOfTick`·`ticksPerDay`·차트 게이팅이 이 상수 파생이라 자동 반영
- `build_daily_candles` (신규 마이그레이션): `group by (tick_index / 6)`, 버킷 폭 6틱
- 마이그레이션: `daily_candles` 재빌드 — **이벤트 개장(8/1) 전이라 리허설 reset으로 처리**(보존할 실데이터 없음). 기존 5분 버킷 행은 reset/재빌드로 1분 버킷으로 대체된다.

### 서비스
- `src/services/chartService.ts`:
  - `INTRADAY_CANDLE_DAYS` 7 → 3
  - `candleTimeEpoch`의 버킷 폭 `bucket * CANDLE_INTERVAL_MINUTES * 60` → `CANDLE_INTERVAL_MINUTES`가 1이 되므로 자동으로 분 단위(60초). 주석의 "*300" 설명 갱신
  - `totalBuckets = ticksPerDay(hours) / TICKS_PER_CANDLE` = 720 (상수 파생, 코드 변경 없음)

### 프론트
- `src/components/chart/StockChart.tsx`:
  - `Mode`에 `"m1"` 추가
  - `MINUTES_BY_MODE`에 m5(=5분) 포함해 1분봉 재집계로 통일 (m1은 재집계 없이 원본 1분봉 사용)
  - `refetchInterval` 5분 → 1분
  - 오늘 라인에 `useQuotes` 현재가 tip append (10초 갱신), `series.update()`로 마지막 점만 갱신
  - stale 주석 정리 (`"틱 주기와 동일"`)
- 관련 stale 주석: `AssetSummaryCard.tsx`의 `"5분 틱 갱신"` 등도 정리

## 안전성 (아키텍처 원칙 위반 없음)

- **원칙 2(미래유출 방지)**: tip = `getTickIndex` 클램프된 현재가 → 유출 불가. 완료된 1분봉만 노출(`bucket < currentBucket`), 게이팅 로직 불변.
- **원칙 4(연출은 표시용)**: 체결가는 서버 틱값 고정. 차트 tip은 표시용일 뿐 체결과 무관.
- **원칙 1(돈 계산은 서버)**: 거래 함수 변경 없음. 이 작업은 차트 표시 레이어 한정.

## 스코프 외 (YAGNI)

- 접근 3(부분버킷 실시간 집계)
- 프론트 wiggle 보간 개편 — tip과 충돌만 점검, 별도 과제
- 거래량 실시간 tip, VI 실시간 배너 강화

## 검증

- `npm run build` + `npm run lint` 통과
- 로컬 `supabase db reset` 후 1분봉 720버킷 생성·게이팅 확인
- `verify` 레시피(dev + agent-browser)로 실앱에서: 1분봉 토글 렌더, 오늘 라인 tip 10초 갱신, 미래유출 없음(현재 틱 이후 데이터 미노출) 확인

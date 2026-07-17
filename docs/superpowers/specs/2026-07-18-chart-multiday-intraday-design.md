# 차트 다일(多日) 분봉 + 라인 fallback 설계

- 날짜: 2026-07-18
- 대상: `src/services/chartService.ts`, `src/components/chart/StockChart.tsx`

## 문제

- 라인·분봉 모드가 **오늘 날짜 틱(`today`)만** 그려서, 여러 날이 이어져 쌓이는 건 일봉뿐이다.
- 장 마감 후/개장 전(오늘 틱이 아직 없는 시간대)엔 라인·분봉이 "아직 오늘 장이 열리지 않았습니다"로 빈 화면이 된다.
- 사용자는 데이터가 "쭉쭉 쌓이며" 전 기간을 확인하길 원한다.

## 데이터 전제

- 일일 배치는 `delete from daily_ticks where date = p_tomorrow` 후 익일 틱만 삽입 → **과거 날짜 5분 틱이 DB에 그대로 누적**되어 있다. 다일 조회 가능.
- lightweight-charts는 데이터 포인트를 **등간격 슬롯**에 배치(빈 시간대는 슬롯 미생성)하므로, 여러 날 틱을 각자 절대 epoch로 넣으면 밤 12시간 공백 없이 이어진다.

## 방향 (사용자 확정)

- **분봉(15/30/60분)**: 이벤트 전 기간 누적 틱 집계.
- **라인**: 당일 5분. 단, 오늘 틱이 없으면 **직전 세션(마지막 날짜) 라인**을 fallback으로 표시.
- **일봉**: 기존 유지.

## 1. 데이터 계층 — `chartService.ts`

- `ChartData`에 `intraday: IntradayPoint[]` 필드 추가 (분봉 집계 소스, 여러 날).
- daily_ticks를 `date <= today`로 조회(미래 유출 차단), 결과에서 **오늘 날짜의 `tick_index > maxTick` 행만 메모리에서 컷**한다.
  - `maxTick === null`(개장 전/장외): 오늘 틱 전부 제외 → 과거만.
  - 데이터량이 작아(종목 1개 × 최대 30일 × 144틱) 단일 쿼리 + JS 필터로 충분.
- 각 틱을 `tickTimeEpoch(row.date, row.tick_index, openHour)`로 변환 → 절대 시간축. `(date, tick_index)` 오름차순.
- `today`(라인용): 결과에서 오늘 날짜만 필터. **비어 있으면 `intraday`의 마지막 날짜 세그먼트로 채운다**(라인 fallback). 추가 쿼리 없음.

## 2. 화면 계층 — `StockChart.tsx`

- 분봉 집계 소스를 `data.today` → `data.intraday`로 교체. `aggregateCandles`는 절대 epoch 버킷이라 다일에서도 그대로 동작.
- 고저 마커·거래량·hover 오버레이도 분봉은 `intraday` 기준.
- 라인은 `data.today`(오늘 or fallback 직전 세션) 그대로.
- 빈 화면 조건(`todayEmpty`)은 라인 모드 + `today` 비어있음(=이벤트 최초 개장 전, 데이터 전무)일 때만. 문구를 "곧 첫 장이 열려요" 계열로 개선.

## 다루지 않음 (YAGNI)

- `afterClose` 로직: 운영 `closeHour=24`에선 자정에 게임 날짜가 넘어가며 오늘분이 어제로 자동 편입돼 무해. 증상 원인 아님 → 미변경.
- 라인 다일화, 보관 기간 제한: 범위 밖.

## 검증

- `npm run build`, `npm run lint` 통과.
- verify 스킬(dev + agent-browser)로 실제 앱에서 분봉 다일 렌더·라인 fallback 확인.

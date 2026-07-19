# 배치·틱 생성 검증 참조

batch-tick-verifier가 로드한다. "가격은 사전 생성 경로"(아키텍처 2원칙)를 검증한다.

## 검증 대상

- `apply_daily_batch(...)` — 익일 뉴스·공시·요약 생성. **틱 자체는 여기서 삽입하지 않고** 청크 RPC로 위임. 마이그: `20260712010000_daily_batch`, `20260712030000_news_batch`, `20260719110000_batch_tick_chunk_insert`.
- `insert_daily_ticks_chunk(p_date, p_ticks)` — 익일 틱을 청크 단위로 멱등 upsert. `batchService.ts`가 청크로 나눠 호출. 마이그: `20260719110000_batch_tick_chunk_insert`.
- `replace_future_ticks(...)` — 거래량 등 미래 틱 치환. 마이그: `20260717000000_replace_future_ticks_volume`.
- `reschedule_daily_batch(...)` — 폐장 시각 트리거 재설정.
- 캔들 백필: `20260720000000_backfill_candles` / `20260720020000_fix_backfill_bucketing`. 틱→캔들 버킷팅(`TICKS_PER_CANDLE=30`, 5분 캔들).

## 수동 실행

```bash
curl -X POST "localhost:3000/api/cron/daily-batch?date=YYYY-MM-DD" \
  -H "Authorization: Bearer $CRON_SECRET"
# date는 부트스트랩 시 '어제'로 지정 (익일 틱 생성 대상)
```

## 체크리스트

1. **틱 수 정합**: 장 시간(현재 12:00~24:00)에서 파생된 틱 수(**4320틱, 10초 간격** — `TICK_INTERVAL_SECONDS=10`, `ticksPerDay=(close-open)*3600/10`, `src/lib/market.ts`)가 정확히 생성되는가. 전 종목 청크 삽입이 누락 없이 4320×종목수 행을 채우는가(멱등 upsert).
2. **현재가 인덱스**: 현재가 = 현재 시각의 틱 인덱스 값인가. 거래가 읽는 인덱스와 배치가 채운 인덱스가 일치하는가.
3. **상하한 파생**: 밴드가 **직전 개장일 종가**에서 올바르게 계산되는가. 휴장일 지정 시 조건부 처리(PRD §4.1).
4. **장중 읽기 전용**: 장중에 틱이 변경되지 않는가(배치만 쓰고 장중엔 읽기만).

## 과거 장애 회귀 (반드시 확인)

1. **PostgREST max_rows=1000**: `daily_ticks` 전 종목 조회는 1000행에서 잘린다. range 페이지네이션이 있는가. 홈/지수 직전 세션 fallback도 페이지네이션과 함께 올바른가.
2. **pg_net 타임아웃**: 배치 내 HTTP(공시·익일뉴스)가 `net._http_response`에서 timed_out 나지 않도록 `timeout_milliseconds`가 충분한가. main은 `20260720010000_batch_pgnet_timeout`이 cron job command의 타임아웃을 **120000ms로 마이그레이션 강제**(수동 절차 아님). 공시·익일뉴스 누락 시 이 로그부터 확인.
3. **빈 차트 = 틱 미생성**: 프로덕션 빈 차트는 장 시간 버그가 아니라 틱 미생성이다. `?date=어제` 부트스트랩 경로가 성립하는가.

## 검증 절차

```bash
# 어제 date로 배치 실행 → daily_ticks 채워지는지
curl -X POST "localhost:3000/api/cron/daily-batch?date=$(date -v-1d +%F)" -H "Authorization: Bearer $CRON_SECRET"
# psql: 종목당 틱 수가 4320인지, 전 종목 조회(=4320×종목수 행)가 1000행에 잘리지 않는지
```

## 좀비 방지

dev 서버를 배경 기동해 검증할 때는 워치독으로 감싸고, 검증 후 잔존 프로세스를 청소한다(중복 기동 금지).

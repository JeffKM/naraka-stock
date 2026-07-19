-- raw 10초틱 프루닝 (Task 16)
--
-- 배경: 10초 틱 전환(Task 4) 이후 daily_ticks가 종목당 하루 최대 4,320행(24시간
-- 기준) 쌓인다 — 월 누적 약 5.4M행. 차트는 이제 daily_candles(Task 5, 영구 보관
-- 5분 OHLC)를 읽으므로, 집계가 끝난 오래된 raw 10초틱은 안전하게 지울 수 있다.
--
-- 안전성 확인(코디네이터 지시로 사전 조사): daily_ticks를 "오래된 날짜"로 조회하는
-- 소비처가 있는지 확인했다.
--   - quoteService.getQuoteBoard 직전 세션 fallback: `.lt("date", today)` 로 오늘
--     이전 가장 최근 날짜 하나만 찾아 그 날의 틱만 로드 — 정기 휴장이 없으므로
--     통상 1일 전. keep_days=3이면 여유 있게 안전.
--   - tickService.loadDayLastTicks / adminService 재조정: 항상 특정 p_date(오늘)만
--     조회, 과거 날짜를 훑지 않음.
--   - settle_limit_orders: order_date < v_today(오늘 이전) 주문은 daily_ticks를
--     조회하기 "전에" 무조건 만료 처리(509~513행) — 과거 날짜 틱을 읽는 경로 없음.
--   - build_daily_candles: p_date(집계 대상 하루)만 조회.
-- 결론: 모든 소비처가 오늘 또는 그 직전 하루만 daily_ticks를 읽는다.
-- keep_days=3 기본값은 이 여유(1일)의 3배로 안전 마진을 둔다.
--
-- 주의: current_date는 Postgres 세션 타임존(기본 UTC) 기준이라 배치가 쓰는 KST
-- 날짜와 어긋날 수 있다. 다른 마이그레이션의 확립된 패턴(v_kst := ... at time zone
-- 'Asia/Seoul')과 일관되게 KST 자정 기준으로 오늘을 계산한다.
create or replace function prune_old_ticks(p_keep_days int default 3)
returns void
language sql
as $$
  delete from daily_ticks
  where date < ((now() at time zone 'Asia/Seoul')::date - p_keep_days);
$$;

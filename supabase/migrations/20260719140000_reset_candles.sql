-- reset_rehearsal_data에 daily_candles 정리 추가 (Task 17)
--
-- 문제: daily_candles(20260719100500_daily_candles.sql, 5분 OHLC 사전 집계 테이블)가
--       daily_ticks보다 나중에 추가됐는데, reset_rehearsal_data는 daily_ticks만
--       비우고 daily_candles는 그대로 둔다 — 리허설 초기화 후에도 이전 회차의
--       스테일 캔들이 차트에 남아 daily_ticks와 어긋난다(차트는 daily_candles만
--       읽으므로 초기화가 눈에 보이는 형태로 반영되지 않음).
-- 조치: 최신 정의(20260718090100_weekly_badges_functions.sql)를 베이스로 본문은
--       한 글자도 바꾸지 않고, daily_ticks 삭제 직후에 daily_candles 삭제 한 줄만
--       추가한 전체 재정의. 다른 테이블·순서·FK 처리는 전부 그대로 보존한다.

create or replace function reset_rehearsal_data(p_baseline_date date)
returns jsonb
language plpgsql
as $$
declare
  v_users int;
  v_trades int;
  v_ticks int;
  v_news int;
begin
  -- 주의: Supabase API 세션은 WHERE 없는 DELETE를 차단(pg-safeupdate)하므로
  -- 전체 삭제에도 where true를 명시한다
  select count(*) into v_trades from trades;
  delete from orders where true;
  delete from trades where true;
  delete from holdings where true;
  delete from weekly_badge_awards where true;
  delete from user_asset_snapshots where true;
  delete from visit_claims where true;
  delete from attendance_claims where true;

  -- 유저 참조 정리 (reset 함수 이후 추가된 테이블 — NO ACTION FK라 users 삭제 전 선제거).
  -- signup_requests는 signup_codes.code를 참조하므로 signup_codes 삭제보다도 먼저 지운다.
  delete from cash_adjustments where true;
  delete from signup_requests where true;

  -- 일반 유저가 쓴 가입 코드는 기록째 제거 (재사용 방지)
  delete from signup_codes
    where used_by in (select id from users where not is_admin);

  select count(*) into v_users from users where not is_admin;
  delete from users where not is_admin;

  select count(*) into v_ticks from daily_ticks;
  delete from daily_ticks where true;
  -- daily_candles(5분 OHLC 사전 집계, Task 5)는 daily_ticks에서 파생되므로
  -- daily_ticks를 비우면 함께 비워야 스테일 캔들이 남지 않는다.
  delete from daily_candles where true;
  delete from daily_summary where date <> p_baseline_date;
  delete from index_history where true;

  select count(*) into v_news from news;
  delete from news where true;

  -- 배치·배당·서킷브레이커 상태 초기화 (장 운영 설정은 유지)
  delete from config
    where key in ('last_dividend_date', 'last_batch_date', 'circuit_breaker_until');

  return jsonb_build_object(
    'usersDeleted', v_users,
    'tradesDeleted', v_trades,
    'ticksDeleted', v_ticks,
    'newsDeleted', v_news
  );
end $$;

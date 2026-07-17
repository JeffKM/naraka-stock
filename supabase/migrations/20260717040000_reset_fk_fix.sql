-- reset_rehearsal_data FK 정합 수정 (섹터 개편 Plan 5 배포 중 발견)
--
-- 문제: reset_rehearsal_data(2026-07-13 작성)가 users 삭제 전에 cash_adjustments·
--       signup_requests를 정리하지 않는다. 두 테이블은 그 이후(2026-07-14) 추가됐고
--       users를 NO ACTION FK로 참조하므로, admin cash adjust를 받은 비어드민
--       리허설 계정이 있으면 `delete from users where not is_admin`이 FK 위반으로 실패한다
--       ("cash_adjustments_user_id_fkey ... is still referenced").
-- 조치: users 삭제 전에 cash_adjustments·signup_requests를 선제거. signup_requests는
--       signup_codes.code를 참조하므로 signup_codes 삭제보다도 먼저 지워 code FK 차단도 예방.
--       (둘 다 리허설 활동 기록이라 개장 전 초기화 대상으로 적절.)

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
  delete from visit_claims where true;

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

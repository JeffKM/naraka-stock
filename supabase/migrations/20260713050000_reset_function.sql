-- 리허설 데이터 초기화 (개장 전 1회 실행용, 단일 트랜잭션)
--
-- 지우는 것: 일반 유저 계정·거래·보유·보너스 수령, 사용된 가입 코드,
--            가격 데이터(기준가 제외), 뉴스 전체, 배치·배당·CB 상태
-- 남기는 것: 어드민 계정, 미사용 가입 코드, 방문 코드, 기준가(daily_summary의 p_baseline_date)

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
  delete from trades where true;
  delete from holdings where true;
  delete from visit_claims where true;

  -- 일반 유저가 쓴 가입 코드는 기록째 제거 (재사용 방지)
  delete from signup_codes
    where used_by in (select id from users where not is_admin);

  select count(*) into v_users from users where not is_admin;
  delete from users where not is_admin;

  select count(*) into v_ticks from daily_ticks;
  delete from daily_ticks where true;
  delete from daily_summary where date <> p_baseline_date;

  select count(*) into v_news from news;
  delete from news where true;

  -- 배치·배당·서킷브레이커 상태 초기화 + 장 시간 정식값 보정
  delete from config
    where key in ('last_dividend_date', 'last_batch_date', 'circuit_breaker_until');
  update config set value = '15' where key = 'market_open_hour';
  update config set value = '22' where key = 'market_close_hour';

  return jsonb_build_object(
    'usersDeleted', v_users,
    'tradesDeleted', v_trades,
    'ticksDeleted', v_ticks,
    'newsDeleted', v_news
  );
end $$;

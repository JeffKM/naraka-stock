-- 출석 스트릭 보너스 (몰입 스펙 2026-07-18)
--
-- 매장 방문 보너스(claim_visit_bonus, 코드 필요)와 별개로, 하루 1회 단순 접속만으로
-- 현금을 지급한다. 연속 출석(스트릭) 단계별로 증액하고, 하루 결석 시 1일차로 리셋한다.
-- 방문 보너스와 동일하게 지급을 서버 단일 트랜잭션(함수)으로 처리한다.

create table attendance_claims (
  user_id bigint not null references users (id) on delete cascade,
  date date not null,
  streak int not null,
  amount bigint not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- 다른 테이블과 동일하게 RLS 전면 차단 (service role만 통과)
alter table attendance_claims enable row level security;
alter table attendance_claims force row level security;

-- 스트릭 단계별 금액 (경계 2일/6일은 함수 상수, 금액만 config로 조정 가능)
insert into config (key, value) values
  ('attendance_amount_1', '300000'),  -- 연속 1~2일차
  ('attendance_amount_2', '500000'),  -- 연속 3~6일차
  ('attendance_amount_3', '700000')   -- 연속 7일차 이상 (유지)
on conflict (key) do nothing;

-- 스트릭 → 금액. 경계(2/6)는 여기 고정, 금액은 config 조회.
create or replace function attendance_amount(p_streak int)
returns bigint
language sql
stable
as $$
  select (value #>> '{}')::bigint from config
  where key = case
    when p_streak <= 2 then 'attendance_amount_1'
    when p_streak <= 6 then 'attendance_amount_2'
    else 'attendance_amount_3'
  end;
$$;

-- 출석 보너스 수령: 오늘 1회, 연속일 계산 후 단계별 현금 지급.
-- p_at: 테스트용 시각 오버라이드 (기본 now()). KST 날짜 기준.
create or replace function claim_attendance_bonus(
  p_user_id bigint,
  p_at timestamptz default now()
) returns jsonb
language plpgsql
as $$
declare
  v_today date := (p_at at time zone 'Asia/Seoul')::date;
  v_prev date;
  v_streak int;
  v_amount bigint;
  v_cash bigint;
begin
  -- 직전 수령일 (오늘 이전 중 가장 최근)
  select max(date) into v_prev
    from attendance_claims
    where user_id = p_user_id and date < v_today;

  -- 어제 받았으면 스트릭 +1, 아니면(결석·첫 수령) 1일차로 리셋
  if v_prev = v_today - 1 then
    select streak + 1 into v_streak
      from attendance_claims
      where user_id = p_user_id and date = v_prev;
  else
    v_streak := 1;
  end if;

  v_amount := attendance_amount(v_streak);

  -- 오늘 1회 기록 (중복이면 지급 없이 예외)
  begin
    insert into attendance_claims (user_id, date, streak, amount)
      values (p_user_id, v_today, v_streak, v_amount);
  exception when unique_violation then
    raise exception 'ATTENDANCE_ALREADY_CLAIMED';
  end;

  update users set cash = cash + v_amount
    where id = p_user_id
    returning cash into v_cash;

  return jsonb_build_object('cash', v_cash, 'streak', v_streak, 'amount', v_amount);
end $$;

-- 출석 상태 조회 (UI 표시용): 오늘 수령 여부·현재 스트릭·다음 수령 금액.
create or replace function attendance_status(
  p_user_id bigint,
  p_at timestamptz default now()
) returns jsonb
language plpgsql
stable
as $$
declare
  v_today date := (p_at at time zone 'Asia/Seoul')::date;
  v_today_row attendance_claims%rowtype;
  v_prev date;
  v_prev_streak int;
  v_next_streak int;
begin
  select * into v_today_row
    from attendance_claims where user_id = p_user_id and date = v_today;

  if found then
    -- 이미 받음: 현재 스트릭 = 오늘 기록, 다음 금액은 내일(스트릭+1) 기준 참고값
    return jsonb_build_object(
      'claimedToday', true,
      'currentStreak', v_today_row.streak,
      'nextStreak', v_today_row.streak + 1,
      'nextAmount', attendance_amount(v_today_row.streak + 1)
    );
  end if;

  -- 아직 안 받음: 오늘 받으면 될 스트릭 계산
  select max(date) into v_prev
    from attendance_claims where user_id = p_user_id and date < v_today;
  if v_prev = v_today - 1 then
    select streak into v_prev_streak
      from attendance_claims where user_id = p_user_id and date = v_prev;
    v_next_streak := v_prev_streak + 1;
  else
    v_next_streak := 1;
  end if;

  return jsonb_build_object(
    'claimedToday', false,
    'currentStreak', coalesce(v_prev_streak, 0),
    'nextStreak', v_next_streak,
    'nextAmount', attendance_amount(v_next_streak)
  );
end $$;

-- ---------------------------------------------------------------------------
-- reset_rehearsal_data 갱신: 출석 기록도 리허설 초기화 대상에 포함
--
-- 20260717040000_reset_fk_fix.sql의 최신 정의(orders/cash_adjustments/
-- signup_requests/index_history 정리 포함)를 그대로 복사하고, delete from
-- visit_claims where true; 바로 아래에 attendance_claims 삭제 한 줄만 추가한다.
-- ---------------------------------------------------------------------------

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

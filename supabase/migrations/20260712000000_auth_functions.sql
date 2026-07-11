-- 인증·계정 관련 Postgres 함수 (Phase 1)
--
-- 돈이 걸린 상태 변경은 전부 DB 함수 단일 트랜잭션으로 처리한다 (아키텍처 원칙 1).
-- 도메인 오류는 raise exception '<ApiErrorCode>'로 던지고, 서비스 레이어가
-- 메시지를 ApiException으로 변환한다.

-- 가입: 코드 검증 → 유저 생성 → 코드 소멸 (단일 트랜잭션, T-101/T-103)
create or replace function signup_user(
  p_code text,
  p_nickname text,
  p_password_hash text
) returns bigint
language plpgsql
as $$
declare
  v_user_id bigint;
begin
  -- 코드 행 잠금으로 동시 사용 경합 방지 (미사용 코드만)
  perform 1 from signup_codes
    where code = p_code and used_by is null
    for update;
  if not found then
    raise exception 'CODE_INVALID';
  end if;

  begin
    insert into users (nickname, password_hash)
      values (p_nickname, p_password_hash)
      returning id into v_user_id;
  exception when unique_violation then
    raise exception 'NICKNAME_TAKEN';
  end;

  update signup_codes
    set used_by = v_user_id, used_at = now()
    where code = p_code;

  return v_user_id;
end $$;

-- 방문 보너스 수령: 당일 코드 검증 → 1일 1회 기록 → 잔고 지급 (T-104)
-- 반환: 지급 후 현금 잔고
create or replace function claim_visit_bonus(
  p_user_id bigint,
  p_code text
) returns bigint
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_bonus bigint;
  v_cash bigint;
begin
  if not exists (
    select 1 from visit_codes where date = v_today and code = p_code
  ) then
    raise exception 'CODE_INVALID';
  end if;

  begin
    insert into visit_claims (user_id, date) values (p_user_id, v_today);
  exception when unique_violation then
    raise exception 'CODE_ALREADY_USED';
  end;

  select (value #>> '{}')::bigint into v_bonus
    from config where key = 'visit_bonus';

  update users
    set cash = cash + v_bonus
    where id = p_user_id
    returning cash into v_cash;

  return v_cash;
end $$;

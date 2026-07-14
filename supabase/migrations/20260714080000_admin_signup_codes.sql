-- 어드민 발급코드 (사장님 계정 발급용)
--
-- 기존 가입 코드는 전부 일반 손님 계정을 만들었고, 어드민 승격은 수동 SQL로만
-- 가능했다. 이제 발급코드에 is_admin 플래그를 두어, 그 코드로 가입하면 곧바로
-- 어드민 계정이 되도록 한다. 코드 생성 자체가 requireAdmin 뒤에 있으므로
-- 어드민만 어드민 코드를 뽑을 수 있다.

alter table signup_codes
  add column if not exists is_admin boolean not null default false;

-- signup_user: 코드의 is_admin을 읽어 유저에 반영하고, 생성 결과를 반환한다.
-- 반환 타입이 bigint → jsonb로 바뀌므로 기존 함수를 먼저 제거한다.
drop function if exists signup_user(text, text, text);

create function signup_user(
  p_code text,
  p_nickname text,
  p_password_hash text
) returns jsonb
language plpgsql
as $$
declare
  v_user_id bigint;
  v_is_admin boolean;
begin
  -- 코드 행 잠금으로 동시 사용 경합 방지 (미사용 코드만) + is_admin 조회
  select is_admin into v_is_admin
    from signup_codes
    where code = p_code and used_by is null
    for update;
  if not found then
    raise exception 'CODE_INVALID';
  end if;

  begin
    insert into users (nickname, password_hash, is_admin)
      values (p_nickname, p_password_hash, v_is_admin)
      returning id into v_user_id;
  exception when unique_violation then
    raise exception 'NICKNAME_TAKEN';
  end;

  update signup_codes
    set used_by = v_user_id, used_at = now()
    where code = p_code;

  return jsonb_build_object('id', v_user_id, 'is_admin', v_is_admin);
end $$;

-- 방문자 가입요청 승인제 (T-106)
--
-- 지금까지는 코드가 유효하면 signup_user가 곧바로 유저를 만들고 자동 로그인시켰다.
-- 상품이 걸린 이벤트라, 손님(방문자) 계정은 매장 승인을 한 번 거치도록 바꾼다.
--   - 어드민 코드(is_admin=true): 종전대로 즉시 계정 생성 + 자동 로그인
--   - 손님 코드(is_admin=false): 가입요청만 접수(signup_requests) → 어드민 승인 시 유저 생성
-- 코드는 요청 시점에 소모하지 않고 승인 시점에만 소모한다(거절 시 재사용 가능).

create table signup_requests (
  id bigint generated always as identity primary key,
  code text not null references signup_codes(code),
  nickname text not null check (char_length(nickname) between 2 and 8),
  password_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by bigint references users(id)
);

-- 미처리 요청 목록 조회용 (오래된 순)
create index signup_requests_pending_idx
  on signup_requests (created_at)
  where status = 'pending';

-- 같은 코드로 대기 중인 요청은 하나만 허용 (중복 접수 방지)
create unique index signup_requests_one_pending_per_code
  on signup_requests (code)
  where status = 'pending';

-- 같은 닉네임으로 대기 중인 요청도 하나만 (최종 유일성은 승인 시 users unique가 담당)
create unique index signup_requests_one_pending_per_nickname
  on signup_requests (nickname)
  where status = 'pending';

-- signup_user: 어드민 코드는 즉시 계정 생성, 손님 코드는 가입요청 접수로 분기한다.
-- 반환 jsonb의 status로 호출부가 자동 로그인 여부를 판단한다.
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
  -- 미사용 코드만 잠금 (동시 사용 경합 방지) + is_admin 조회
  select is_admin into v_is_admin
    from signup_codes
    where code = p_code and used_by is null
    for update;
  if not found then
    raise exception 'CODE_INVALID';
  end if;

  -- 어드민 코드: 종전대로 즉시 계정 생성 + 코드 소모 (자동 로그인 대상)
  if v_is_admin then
    begin
      insert into users (nickname, password_hash, is_admin)
        values (p_nickname, p_password_hash, true)
        returning id into v_user_id;
    exception when unique_violation then
      raise exception 'NICKNAME_TAKEN';
    end;

    update signup_codes
      set used_by = v_user_id, used_at = now()
      where code = p_code;

    return jsonb_build_object('status', 'active', 'id', v_user_id, 'is_admin', true);
  end if;

  -- 손님 코드: 가입요청만 접수한다 (유저 생성·코드 소모는 승인 시점).
  -- 이미 가입 완료된 닉네임이면 대기 후 실패를 줄이도록 미리 막는다.
  if exists (select 1 from users where nickname = p_nickname) then
    raise exception 'NICKNAME_TAKEN';
  end if;

  begin
    insert into signup_requests (code, nickname, password_hash)
      values (p_code, p_nickname, p_password_hash);
  exception when unique_violation then
    -- 같은 코드로 이미 요청됐거나, 대기 중 닉네임이 겹침
    raise exception 'REQUEST_DUPLICATE';
  end;

  return jsonb_build_object('status', 'pending');
end $$;

-- 가입요청 승인: 대기 요청 잠금 → 코드·닉네임 재검증 → 유저 생성 → 코드 소모 → 요청 종결
create function approve_signup_request(
  p_request_id bigint,
  p_admin_id bigint
) returns jsonb
language plpgsql
as $$
declare
  v_code text;
  v_nickname text;
  v_password_hash text;
  v_user_id bigint;
begin
  select code, nickname, password_hash
    into v_code, v_nickname, v_password_hash
    from signup_requests
    where id = p_request_id and status = 'pending'
    for update;
  if not found then
    raise exception 'REQUEST_INVALID';
  end if;

  -- 요청 접수 이후 코드가 소모되지 않았는지 재확인 (미사용 코드만 잠금)
  perform 1 from signup_codes
    where code = v_code and used_by is null
    for update;
  if not found then
    raise exception 'CODE_INVALID';
  end if;

  begin
    insert into users (nickname, password_hash, is_admin)
      values (v_nickname, v_password_hash, false)
      returning id into v_user_id;
  exception when unique_violation then
    raise exception 'NICKNAME_TAKEN';
  end;

  update signup_codes
    set used_by = v_user_id, used_at = now()
    where code = v_code;

  update signup_requests
    set status = 'approved', decided_at = now(), decided_by = p_admin_id
    where id = p_request_id;

  return jsonb_build_object('id', v_user_id);
end $$;

-- 가입요청 거절: 대기 요청만 rejected로 종결한다 (코드는 미사용으로 남아 재사용 가능).
create function reject_signup_request(
  p_request_id bigint,
  p_admin_id bigint
) returns void
language plpgsql
as $$
begin
  update signup_requests
    set status = 'rejected', decided_at = now(), decided_by = p_admin_id
    where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'REQUEST_INVALID';
  end if;
end $$;

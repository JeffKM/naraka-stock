-- 어드민 현금 지급/차감 (T-605 확장)
--
-- 사장님이 매장에서 손님에게 상품·이벤트 명목으로 가상 현금을 직접 지급하거나
-- 회수할 수 있게 한다. 상품이 걸린 이벤트라 조작·오지급 추적이 곧 공정성이므로
-- 모든 조정 이력을 감사 로그로 남긴다. 잔고 변경은 단일 트랜잭션 함수로만 처리한다.

-- 조정 감사 로그 (누가 누구에게 얼마를, 조정 후 잔고까지 기록)
create table cash_adjustments (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id),
  admin_id bigint not null references users (id),
  amount bigint not null, -- 양수 = 지급, 음수 = 회수
  reason text not null default '',
  balance_after bigint not null, -- 조정 직후 대상 유저 현금
  created_at timestamptz not null default now()
);

create index cash_adjustments_user_idx on cash_adjustments (user_id, created_at desc);

-- 어드민 현금 조정: 잔고 검증 → 갱신 → 감사 로그를 한 트랜잭션으로 처리.
-- for update로 대상 행을 잠가 동시 조정을 직렬화한다.
create or replace function admin_adjust_cash(
  p_user_id bigint,
  p_admin_id bigint,
  p_amount bigint,
  p_reason text default ''
) returns bigint
language plpgsql
as $$
declare
  v_cash bigint;
  v_is_admin boolean;
begin
  if p_amount = 0 then
    raise exception 'AMOUNT_ZERO';
  end if;

  select cash, is_admin into v_cash, v_is_admin
    from users where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  -- 어드민 계정은 조정 대상이 아니다 (사장 계정끼리 실수로 건드리는 사고 방지)
  if v_is_admin then
    raise exception 'TARGET_ADMIN';
  end if;

  -- 회수가 보유 현금을 넘으면 차단 (cash >= 0 제약 위반 대신 명시적 에러)
  if v_cash + p_amount < 0 then
    raise exception 'INSUFFICIENT_CASH';
  end if;

  update users
    set cash = cash + p_amount
    where id = p_user_id
    returning cash into v_cash;

  insert into cash_adjustments (user_id, admin_id, amount, reason, balance_after)
    values (p_user_id, p_admin_id, p_amount, coalesce(p_reason, ''), v_cash);

  return v_cash;
end $$;

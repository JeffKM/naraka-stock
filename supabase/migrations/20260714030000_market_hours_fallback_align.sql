-- 장 시간 fallback을 실제 운영값(12~24시)과 일치
--
-- 배경: TS 쪽 DEFAULT_MARKET_HOURS(src/lib/market.ts)를 운영 기본값 12~24시로
-- 맞추면서, SQL 쪽에 남아 있던 15/22 fallback도 함께 정렬한다.
--   - config가 삐끗해도 execute_trade가 장중을 "MARKET_CLOSED"로 오판하지 않게
--     coalesce fallback을 12/24로 교정 (config 행은 정상 시 항상 존재하므로
--     실제로는 방어적 값이지만, TS 폴백과 완전히 일치시킨다).
--   - 운영값 config(market_open_hour=12 / market_close_hour=24)를 idempotent하게 재확정.

-- 1) 운영값 재확정 (fresh reset 시 seed 15/22 → 여기서 12/24로 수렴)
update config set value = '12' where key = 'market_open_hour';
update config set value = '24' where key = 'market_close_hour';

-- 2) 체결 함수: coalesce fallback만 12/24로 교정 (그 외 본문은 080000과 동일)
create or replace function execute_trade(
  p_user_id bigint,
  p_stock_code text,
  p_side text, -- 'buy' | 'sell'
  p_quantity bigint,
  p_at timestamptz default now()
) returns jsonb
language plpgsql
as $$
declare
  v_kst timestamp := p_at at time zone 'Asia/Seoul';
  v_date date := v_kst::date;
  v_open int;
  v_close int;
  v_override jsonb;
  v_tick int;
  v_price bigint;
  v_halted boolean;
  v_cb_until timestamptz;
  v_user record;
  v_holding record;
  v_fee_bp int;
  v_fee bigint := 0;
  v_gross bigint;
  v_new_qty bigint;
  v_new_avg bigint;
  v_trade_id bigint;
begin
  if p_quantity <= 0 then
    raise exception 'VALIDATION';
  end if;
  if p_side not in ('buy', 'sell') then
    raise exception 'VALIDATION';
  end if;

  -- 1) 장 시간 검증 (config 기반, 어드민 조절) + 현재 틱 조회
  --    개장일 여부는 따로 검사하지 않는다: 휴장일엔 틱이 없어 아래 조회가 실패한다.
  --    fallback은 운영 기본값 12~24시 (TS DEFAULT_MARKET_HOURS와 일치).
  v_open := coalesce((select (value #>> '{}')::int from config where key = 'market_open_hour'), 12);
  v_close := coalesce((select (value #>> '{}')::int from config where key = 'market_close_hour'), 24);

  -- 당일 오버라이드가 오늘 날짜면 기본값 대신 사용 (지난 날짜 값은 무시)
  select value into v_override from config where key = 'market_hours_override';
  if v_override is not null and (v_override ->> 'date')::date = v_date then
    v_open := (v_override ->> 'openHour')::int;
    v_close := (v_override ->> 'closeHour')::int;
  end if;

  if extract(hour from v_kst) < v_open or extract(hour from v_kst) >= v_close then
    raise exception 'MARKET_CLOSED';
  end if;
  v_tick := floor(((extract(hour from v_kst) - v_open) * 60 + extract(minute from v_kst)) / 5);

  -- 현재 틱이 없으면(장 시간 연장 당일 등) 마지막 틱 가격으로 체결 — 시세 표시와 동일 규칙
  select price, is_halted into v_price, v_halted
    from daily_ticks
    where stock_code = p_stock_code and date = v_date and tick_index <= v_tick
    order by tick_index desc
    limit 1;
  if not found then
    raise exception 'MARKET_CLOSED';
  end if;

  -- 2) 서킷브레이커 (어드민 수동 발동 — config.circuit_breaker_until)
  select (value #>> '{}')::timestamptz into v_cb_until
    from config where key = 'circuit_breaker_until';
  if v_cb_until is not null and p_at < v_cb_until then
    raise exception 'TRADING_HALTED';
  end if;

  -- 3) VI 거래정지 틱
  if v_halted then
    raise exception 'TRADING_HALTED';
  end if;

  -- 4) 계정 검증 (행 잠금 — 동시 주문 직렬화)
  select id, cash, is_banned into v_user
    from users where id = p_user_id for update;
  if not found then
    raise exception 'UNAUTHORIZED';
  end if;
  if v_user.is_banned then
    raise exception 'BANNED';
  end if;

  select (value #>> '{}')::int into v_fee_bp from config where key = 'sell_fee_bp';
  v_fee_bp := coalesce(v_fee_bp, 30);
  v_gross := v_price * p_quantity;

  if p_side = 'buy' then
    -- 5a) 매수: 잔고 검증 → 차감 → 평단 갱신
    if v_user.cash < v_gross then
      raise exception 'INSUFFICIENT_CASH';
    end if;

    update users set cash = cash - v_gross where id = p_user_id;

    select quantity, avg_price into v_holding
      from holdings
      where user_id = p_user_id and stock_code = p_stock_code
      for update;

    if not found then
      insert into holdings (user_id, stock_code, quantity, avg_price)
        values (p_user_id, p_stock_code, p_quantity, v_price);
    else
      v_new_qty := v_holding.quantity + p_quantity;
      v_new_avg := floor(
        (v_holding.quantity * v_holding.avg_price + v_gross)::numeric / v_new_qty
      );
      update holdings
        set quantity = v_new_qty, avg_price = v_new_avg
        where user_id = p_user_id and stock_code = p_stock_code;
    end if;
  else
    -- 5b) 매도: 보유량 검증 → 수수료 차감 후 입금 → 보유 감소
    select quantity, avg_price into v_holding
      from holdings
      where user_id = p_user_id and stock_code = p_stock_code
      for update;
    if not found or v_holding.quantity < p_quantity then
      raise exception 'INSUFFICIENT_QUANTITY';
    end if;

    v_fee := floor(v_gross * v_fee_bp / 10000.0);
    update users set cash = cash + v_gross - v_fee where id = p_user_id;

    if v_holding.quantity = p_quantity then
      delete from holdings where user_id = p_user_id and stock_code = p_stock_code;
    else
      update holdings
        set quantity = quantity - p_quantity
        where user_id = p_user_id and stock_code = p_stock_code;
    end if;
  end if;

  -- 6) 체결 기록
  insert into trades (user_id, stock_code, side, quantity, price, fee)
    values (p_user_id, p_stock_code, p_side, p_quantity, v_price, v_fee)
    returning id into v_trade_id;

  return jsonb_build_object(
    'tradeId', v_trade_id,
    'price', v_price,
    'quantity', p_quantity,
    'fee', v_fee,
    'cash', (select cash from users where id = p_user_id)
  );
end $$;

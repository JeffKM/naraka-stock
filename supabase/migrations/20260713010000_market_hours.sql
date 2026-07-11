-- 체결 함수의 장 시간을 config 기반으로 전환 (임시 연장·특별 개장 대응)
-- market_open_hour / market_close_hour를 읽고, 없으면 15/22 기본값.

create or replace function execute_trade(
  p_user_id bigint,
  p_stock_code text,
  p_side text,
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

  -- 1) 장 시간 검증 (config 기반) + 현재 틱 조회
  select coalesce((select (value #>> '{}')::int from config where key = 'market_open_hour'), 15)
    into v_open;
  select coalesce((select (value #>> '{}')::int from config where key = 'market_close_hour'), 22)
    into v_close;

  if extract(hour from v_kst) < v_open or extract(hour from v_kst) >= v_close then
    raise exception 'MARKET_CLOSED';
  end if;
  v_tick := least(
    floor(((extract(hour from v_kst) - v_open) * 60 + extract(minute from v_kst)) / 5),
    83
  );

  select price, is_halted into v_price, v_halted
    from daily_ticks
    where stock_code = p_stock_code and date = v_date and tick_index = v_tick;
  if not found then
    raise exception 'MARKET_CLOSED';
  end if;

  -- 2) 서킷브레이커
  select (value #>> '{}')::timestamptz into v_cb_until
    from config where key = 'circuit_breaker_until';
  if v_cb_until is not null and p_at < v_cb_until then
    raise exception 'TRADING_HALTED';
  end if;

  -- 3) VI 거래정지 틱
  if v_halted then
    raise exception 'TRADING_HALTED';
  end if;

  -- 4) 계정 검증 (행 잠금)
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

-- execute_trade: 매수에서 정수 수량(p_quantity) 지정 허용 (T-D1)
--
-- 배경: 매수는 그동안 금액(p_amount) 지정만 허용해 왔다(소수점 주식 파생,
-- 20260714040000_fractional_shares.sql). 이번 변경은 매수에서도 p_quantity를
-- 받되, 소수점 주식 발생을 막기 위해 "정수 수량"만 허용한다.
-- 최신 execute_trade 정의는 20260714070000_limit_orders.sql(지정가 예약주문의
-- pending 예약분 반영)이므로, 그 본문 전체를 기준으로 아래 두 곳만 바꾼다.
--   1) 매수 금액 강제 raise(`buy + p_amount is null` → VALIDATION) 삭제.
--   2) 그 자리에 매수 수량 정수 검증 추가.
-- 나머지 로직(수수료·서킷브레이커·VI·평단·예약분 차감 등)은 전부 그대로 보존.
create or replace function execute_trade(
  p_user_id bigint,
  p_stock_code text,
  p_side text, -- 'buy' | 'sell'
  p_quantity numeric default null, -- 수량 지정 매매(매도 수량모드 / 매수는 정수만)
  p_amount bigint default null, -- 금액 지정 매매(매수·매도 금액모드), 정수 원
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
  v_qty numeric;
  v_gross bigint;
  v_new_qty numeric;
  v_new_avg bigint;
  v_trade_id bigint;
  v_reserved_cash bigint; -- pending 매수 예약금 합
  v_reserved_qty numeric; -- pending 매도 예약수량 합(해당 종목)
  v_avail numeric;        -- 매도 가용 수량 = 보유 − 예약
begin
  if (p_amount is null) = (p_quantity is null) then
    raise exception 'VALIDATION';
  end if;
  if p_side not in ('buy', 'sell') then
    raise exception 'VALIDATION';
  end if;
  -- 매수 수량 지정 시 정수만 허용 (금액 지정은 소수점 주식 파생 — 기존 유지)
  if p_side = 'buy' and p_quantity is not null and p_quantity <> trunc(p_quantity) then
    raise exception 'VALIDATION';
  end if;

  -- 1) 장 시간 + 현재 틱
  v_open := coalesce((select (value #>> '{}')::int from config where key = 'market_open_hour'), 12);
  v_close := coalesce((select (value #>> '{}')::int from config where key = 'market_close_hour'), 24);
  select value into v_override from config where key = 'market_hours_override';
  if v_override is not null and (v_override ->> 'date')::date = v_date then
    v_open := (v_override ->> 'openHour')::int;
    v_close := (v_override ->> 'closeHour')::int;
  end if;
  if extract(hour from v_kst) < v_open or extract(hour from v_kst) >= v_close then
    raise exception 'MARKET_CLOSED';
  end if;
  v_tick := floor(((extract(hour from v_kst) - v_open) * 60 + extract(minute from v_kst)) / 5);

  select price, is_halted into v_price, v_halted
    from daily_ticks
    where stock_code = p_stock_code and date = v_date and tick_index <= v_tick
    order by tick_index desc
    limit 1;
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

  -- 4) 계정 검증 (행 잠금 — 동시 주문·예약 직렬화)
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

  -- 5) 수량/대금 산출
  if p_amount is not null then
    v_qty := trunc(p_amount::numeric / v_price, 6);
  else
    v_qty := trunc(p_quantity, 6);
  end if;
  if v_qty <= 0 then
    raise exception 'VALIDATION';
  end if;
  v_gross := round(v_qty * v_price);
  if v_gross <= 0 then
    raise exception 'VALIDATION';
  end if;

  if p_side = 'buy' then
    -- 6a) 매수: 가용현금(= cash − 매수 예약금) 검증
    v_reserved_cash := (
      select coalesce(sum(reserved_cash), 0) from orders
      where user_id = p_user_id and side = 'buy' and status = 'pending'
    );
    if (v_user.cash - v_reserved_cash) < v_gross then
      raise exception 'INSUFFICIENT_CASH';
    end if;

    update users set cash = cash - v_gross where id = p_user_id;

    select quantity, avg_price into v_holding
      from holdings where user_id = p_user_id and stock_code = p_stock_code for update;
    if not found then
      insert into holdings (user_id, stock_code, quantity, avg_price)
        values (p_user_id, p_stock_code, v_qty, v_price);
    else
      v_new_qty := v_holding.quantity + v_qty;
      v_new_avg := round((v_holding.quantity * v_holding.avg_price + v_gross) / v_new_qty);
      update holdings set quantity = v_new_qty, avg_price = v_new_avg
        where user_id = p_user_id and stock_code = p_stock_code;
    end if;
  else
    -- 6b) 매도: 가용수량(= 보유 − 매도 예약수량) 검증
    select quantity, avg_price into v_holding
      from holdings where user_id = p_user_id and stock_code = p_stock_code for update;
    if not found then
      raise exception 'INSUFFICIENT_QUANTITY';
    end if;
    v_reserved_qty := (
      select coalesce(sum(reserved_qty), 0) from orders
      where user_id = p_user_id and stock_code = p_stock_code
        and side = 'sell' and status = 'pending'
    );
    v_avail := v_holding.quantity - v_reserved_qty;

    -- 금액모드 초과분·반올림 잔량은 "가용 전량"으로 스냅 (예약분은 제외)
    if p_amount is not null and v_qty > v_avail then
      v_qty := v_avail;
    elsif abs(v_avail - v_qty) <= 0.000001 then
      v_qty := v_avail;
    end if;
    if v_avail < v_qty or v_qty <= 0 then
      raise exception 'INSUFFICIENT_QUANTITY';
    end if;

    v_gross := round(v_qty * v_price);
    v_fee := floor(v_gross * v_fee_bp / 10000.0);
    update users set cash = cash + v_gross - v_fee where id = p_user_id;

    if v_holding.quantity = v_qty then
      delete from holdings where user_id = p_user_id and stock_code = p_stock_code;
    else
      update holdings set quantity = quantity - v_qty
        where user_id = p_user_id and stock_code = p_stock_code;
    end if;
  end if;

  insert into trades (user_id, stock_code, side, quantity, price, fee)
    values (p_user_id, p_stock_code, p_side, v_qty, v_price, v_fee)
    returning id into v_trade_id;

  return jsonb_build_object(
    'tradeId', v_trade_id,
    'price', v_price,
    'quantity', v_qty,
    'fee', v_fee,
    'cash', (select cash from users where id = p_user_id)
  );
end $$;

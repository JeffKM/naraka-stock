-- 10초 틱 전환 (Task 4): daily_ticks CHECK 완화 + 현재 틱 산출 초 기반 전환
--
-- 배경: 틱 간격을 5분 → 10초로 바꾼다. tick_index 상한은 장 시간 config에 따라
-- 가변인데 기존 CHECK(0~287)는 "5분 틱 × 24시간" 고정값이라 10초 틱(하루 최대
-- 4,320개)을 넣을 수 없다. 하한(0 이상)만 남기고 상한은 배치가 생성하는 실제
-- 틱 개수에 맡긴다. smallint(최대 32767)로 4,320을 담기엔 충분해 타입 변경은
-- 불필요.
--
-- 그리고 "현재 시각 → 현재 틱 인덱스"를 계산하는 모든 살아있는(live) 함수의
-- v_tick 산출식을 분 기반(/5)에서 초 기반(/10)으로 바꾼다. 대상은 아래 3개뿐
-- (rg로 v_tick 산출 패턴을 전수 확인 — 나머지 정의는 이후 마이그레이션에서
-- 재정의돼 이미 죽은 버전):
--   1) execute_trade        — live 정의: 20260716040000_buy_quantity.sql
--   2) place_limit_order    — live 정의: 20260714070000_limit_orders.sql
--   3) settle_limit_orders  — live 정의: 20260714070000_limit_orders.sql
--      (v_cur_tick 계산 + v_max_tick 클램프 + 소급 체결시각 복원 make_interval 포함)
-- 각 함수는 v_tick(또는 상응하는 틱 산출) 라인만 바꾸고 나머지 본문(잔고검증·
-- 체결·기록·예외 처리 등)은 live 정의를 통째로 보존한다.

-- ---------------------------------------------------------------------------
-- 1) daily_ticks.tick_index CHECK 완화: 고정 상한 제거, 하한만 유지
-- ---------------------------------------------------------------------------
alter table daily_ticks drop constraint if exists daily_ticks_tick_index_check;
alter table daily_ticks add constraint daily_ticks_tick_index_nonneg check (tick_index >= 0);
-- smallint(최대 32767) > 4,320(24시간 × 360틱)이라 타입 변경 불필요

-- ---------------------------------------------------------------------------
-- 2) execute_trade 재정의: live 정의(20260716040000_buy_quantity.sql) 본문 그대로 +
--    v_tick 산출만 초 기반으로 교체
-- ---------------------------------------------------------------------------
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
  -- 10초 틱 전환: 분 기반(/5) → 초 기반(/10)
  v_tick := floor((
    (extract(hour from v_kst) - v_open) * 3600
    + extract(minute from v_kst) * 60
    + extract(second from v_kst)
  ) / 10);

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

-- ---------------------------------------------------------------------------
-- 3) place_limit_order 재정의: live 정의(20260714070000_limit_orders.sql) 본문
--    그대로 + v_tick 산출만 초 기반으로 교체
-- ---------------------------------------------------------------------------
create or replace function place_limit_order(
  p_user_id bigint,
  p_stock_code text,
  p_side text, -- 'buy' | 'sell'
  p_limit_price bigint,
  p_amount bigint default null,   -- 매수: 예약 금액(정수 원)
  p_quantity numeric default null, -- 매도: 예약 수량
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
  v_prev_close bigint;
  v_upper bigint;
  v_lower bigint;
  v_reserved_cash bigint;
  v_reserved_qty numeric;
  v_hold_qty numeric;
  v_avail numeric;
  v_qty numeric;
  v_count int;
  v_order_id bigint;
  v_result jsonb;
begin
  if p_side not in ('buy', 'sell') then
    raise exception 'VALIDATION';
  end if;
  if p_limit_price <= 0 then
    raise exception 'VALIDATION';
  end if;
  if p_side = 'buy' then
    if p_amount is null or p_quantity is not null or p_amount <= 0 then
      raise exception 'VALIDATION';
    end if;
  else
    if p_quantity is null or p_amount is not null or p_quantity <= 0 then
      raise exception 'VALIDATION';
    end if;
  end if;

  -- 1) 장 시간 + 현재 틱 (execute_trade와 동일 규칙)
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
  -- 10초 틱 전환: 분 기반(/5) → 초 기반(/10)
  v_tick := floor((
    (extract(hour from v_kst) - v_open) * 3600
    + extract(minute from v_kst) * 60
    + extract(second from v_kst)
  ) / 10);

  select price, is_halted into v_price, v_halted
    from daily_ticks
    where stock_code = p_stock_code and date = v_date and tick_index <= v_tick
    order by tick_index desc
    limit 1;
  if not found then
    raise exception 'MARKET_CLOSED';
  end if;

  -- 2) 정지 중엔 접수도 막음 (시장가와 동일)
  select (value #>> '{}')::timestamptz into v_cb_until
    from config where key = 'circuit_breaker_until';
  if v_cb_until is not null and p_at < v_cb_until then
    raise exception 'TRADING_HALTED';
  end if;
  if v_halted then
    raise exception 'TRADING_HALTED';
  end if;

  -- 3) 밴드밖(±30%) 차단 — quoteService와 동일한 prevClose 기준
  select close into v_prev_close from daily_summary
    where stock_code = p_stock_code and date < v_date
    order by date desc limit 1;
  if v_prev_close is null then
    -- 리허설(과거 요약 없음): 미래 최초 요약으로 폴백
    select close into v_prev_close from daily_summary
      where stock_code = p_stock_code and date > v_date
      order by date asc limit 1;
  end if;
  if v_prev_close is null or v_prev_close <= 0 then
    raise exception 'VALIDATION';
  end if;
  v_upper := round(v_prev_close * 1.3);
  v_lower := round(v_prev_close * 0.7);
  if p_limit_price > v_upper or p_limit_price < v_lower then
    raise exception 'BAND_OUT';
  end if;

  -- 4) 계정 잠금
  select id, cash, is_banned into v_user
    from users where id = p_user_id for update;
  if not found then
    raise exception 'UNAUTHORIZED';
  end if;
  if v_user.is_banned then
    raise exception 'BANNED';
  end if;

  -- 5) 즉시 충족 지정가 → 즉시 시장가 체결 (현재 틱값, 지정가보다 유리)
  if (p_side = 'buy' and v_price <= p_limit_price)
     or (p_side = 'sell' and v_price >= p_limit_price) then
    v_result := execute_trade(p_user_id, p_stock_code, p_side, p_quantity, p_amount, p_at);
    return v_result || jsonb_build_object('immediate', true);
  end if;

  -- 6) 대기 예약: 10건 상한
  select count(*) into v_count from orders
    where user_id = p_user_id and status = 'pending';
  if v_count >= 10 then
    raise exception 'ORDER_LIMIT';
  end if;

  if p_side = 'buy' then
    v_reserved_cash := (
      select coalesce(sum(reserved_cash), 0) from orders
      where user_id = p_user_id and side = 'buy' and status = 'pending'
    );
    if (v_user.cash - v_reserved_cash) < p_amount then
      raise exception 'INSUFFICIENT_CASH';
    end if;
    insert into orders (user_id, stock_code, side, limit_price, reserved_cash, order_date)
      values (p_user_id, p_stock_code, 'buy', p_limit_price, p_amount, v_date)
      returning id into v_order_id;
  else
    select quantity into v_hold_qty from holdings
      where user_id = p_user_id and stock_code = p_stock_code for update;
    if not found then
      raise exception 'INSUFFICIENT_QUANTITY';
    end if;
    v_reserved_qty := (
      select coalesce(sum(reserved_qty), 0) from orders
      where user_id = p_user_id and stock_code = p_stock_code
        and side = 'sell' and status = 'pending'
    );
    v_avail := v_hold_qty - v_reserved_qty;
    v_qty := trunc(p_quantity, 6);
    if abs(v_avail - v_qty) <= 0.000001 then
      v_qty := v_avail; -- "전량" 등 반올림 먼지 스냅
    end if;
    if v_qty <= 0 or v_qty > v_avail then
      raise exception 'INSUFFICIENT_QUANTITY';
    end if;
    insert into orders (user_id, stock_code, side, limit_price, reserved_qty, order_date)
      values (p_user_id, p_stock_code, 'sell', p_limit_price, v_qty, v_date)
      returning id into v_order_id;
  end if;

  return jsonb_build_object(
    'orderId', v_order_id,
    'immediate', false,
    'side', p_side,
    'limitPrice', p_limit_price,
    'reservedCash', case when p_side = 'buy' then p_amount else null end,
    'reservedQty', case when p_side = 'sell' then v_qty else null end
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4) settle_limit_orders 재정의: live 정의(20260714070000_limit_orders.sql) 본문
--    그대로 + 현재 틱(v_cur_tick) 산출·상한 클램프(v_max_tick)·소급 체결시각
--    복원(make_interval)을 초 기반으로 교체. 나머지(만료·체결·기록·예외 처리)는
--    한 줄도 빠짐없이 보존.
-- ---------------------------------------------------------------------------
create or replace function settle_limit_orders(
  p_user_id bigint default null,
  p_at timestamptz default now(),
  p_date date default null,   -- 정산 대상 게임 날짜(배치가 폐장일 명시). null=p_at의 KST 날짜
  p_final boolean default false
) returns jsonb
language plpgsql
as $$
declare
  v_kst timestamp := p_at at time zone 'Asia/Seoul';
  v_today date := coalesce(p_date, v_kst::date);
  v_open int;
  v_close int;
  v_override jsonb;
  v_hour int;
  v_min int;
  v_sec int;
  v_cur_tick int;
  v_max_tick int;
  v_cb_until timestamptz;
  v_fee_bp int;
  r record;
  v_fill record;
  v_fill_time timestamptz;
  v_qty numeric;
  v_gross bigint;
  v_fee bigint;
  v_holding record;
  v_new_qty numeric;
  v_new_avg bigint;
  v_trade_id bigint;
  v_filled int := 0;
  v_expired int := 0;
begin
  -- 장 시간(v_today 기준, 오버라이드 반영)
  v_open := coalesce((select (value #>> '{}')::int from config where key = 'market_open_hour'), 12);
  v_close := coalesce((select (value #>> '{}')::int from config where key = 'market_close_hour'), 24);
  select value into v_override from config where key = 'market_hours_override';
  if v_override is not null and (v_override ->> 'date')::date = v_today then
    v_open := (v_override ->> 'openHour')::int;
    v_close := (v_override ->> 'closeHour')::int;
  end if;
  -- 10초 틱 전환: 시간당 12틱(5분) → 360틱(10초)
  v_max_tick := (v_close - v_open) * 360 - 1;

  select (value #>> '{}')::timestamptz into v_cb_until
    from config where key = 'circuit_breaker_until';
  -- 활성 CB 중엔 (폐장 정산이 아닌 한) 보류: 해제 후 소급 체결해도 결과 동일
  if not p_final and v_cb_until is not null and p_at < v_cb_until then
    return jsonb_build_object('filled', 0, 'expired', 0, 'deferred', true);
  end if;

  -- 현재 유효 틱 상한
  if p_final then
    v_cur_tick := v_max_tick;
  else
    v_hour := extract(hour from v_kst);
    v_min := extract(minute from v_kst);
    v_sec := extract(second from v_kst);
    if v_hour < v_open then
      v_cur_tick := -1;
    elsif v_hour >= v_close then
      v_cur_tick := v_max_tick;
    else
      -- 10초 틱 전환: 분 기반(/5) → 초 기반(/10)
      v_cur_tick := floor(((v_hour - v_open) * 3600 + v_min * 60 + v_sec) / 10);
    end if;
  end if;

  select (value #>> '{}')::int into v_fee_bp from config where key = 'sell_fee_bp';
  v_fee_bp := coalesce(v_fee_bp, 30);

  for r in
    select * from orders
    where status = 'pending'
      and (p_user_id is null or user_id = p_user_id)
      and order_date <= v_today
    order by order_date asc, created_at asc, id asc
    for update skip locked
  loop
    begin
      -- 지난 날짜 미체결은 만료 (배치 누락 안전망)
      if r.order_date < v_today then
        update orders set status = 'expired' where id = r.id;
        v_expired := v_expired + 1;
        continue;
      end if;

      -- 조건 닿은 첫 유효 틱 (정지 틱 제외, 현재 틱 이하)
      select tick_index, price into v_fill
        from daily_ticks
        where stock_code = r.stock_code and date = r.order_date
          and tick_index <= v_cur_tick and is_halted = false
          and ((r.side = 'buy' and price <= r.limit_price)
               or (r.side = 'sell' and price >= r.limit_price))
        order by tick_index asc
        limit 1;

      if not found then
        -- 아직 미충족: 폐장 정산이면 만료, 아니면 다음 기회로 남김
        if p_final then
          update orders set status = 'expired' where id = r.id;
          v_expired := v_expired + 1;
        end if;
        continue;
      end if;

      -- 소급 체결 시각 = 그 틱의 KST 시각 (10초 틱 전환: mins → secs)
      v_fill_time := ((r.order_date::timestamp)
        + make_interval(hours => v_open)
        + make_interval(secs => v_fill.tick_index * 10)) at time zone 'Asia/Seoul';

      if r.side = 'buy' then
        v_qty := trunc(r.reserved_cash::numeric / r.limit_price, 6);
        if v_qty <= 0 then
          update orders set status = 'expired' where id = r.id;
          v_expired := v_expired + 1;
          continue;
        end if;
        v_gross := round(v_qty * r.limit_price);
        -- 예약분이 확보돼 있어야 정상. 방어적으로 잔고 확인(부족 시 만료).
        update users set cash = cash - v_gross where id = r.user_id and cash >= v_gross;
        if not found then
          update orders set status = 'expired' where id = r.id;
          v_expired := v_expired + 1;
          continue;
        end if;

        select quantity, avg_price into v_holding
          from holdings where user_id = r.user_id and stock_code = r.stock_code for update;
        if not found then
          insert into holdings (user_id, stock_code, quantity, avg_price)
            values (r.user_id, r.stock_code, v_qty, r.limit_price);
        else
          v_new_qty := v_holding.quantity + v_qty;
          v_new_avg := round((v_holding.quantity * v_holding.avg_price + v_gross) / v_new_qty);
          update holdings set quantity = v_new_qty, avg_price = v_new_avg
            where user_id = r.user_id and stock_code = r.stock_code;
        end if;
        v_fee := 0;
      else
        v_qty := r.reserved_qty;
        select quantity, avg_price into v_holding
          from holdings where user_id = r.user_id and stock_code = r.stock_code for update;
        if not found then
          update orders set status = 'expired' where id = r.id;
          v_expired := v_expired + 1;
          continue;
        end if;
        if v_holding.quantity < v_qty then
          if abs(v_holding.quantity - v_qty) <= 0.000001 then
            v_qty := v_holding.quantity;
          else
            update orders set status = 'expired' where id = r.id;
            v_expired := v_expired + 1;
            continue;
          end if;
        end if;
        v_gross := round(v_qty * r.limit_price);
        v_fee := floor(v_gross * v_fee_bp / 10000.0);
        update users set cash = cash + v_gross - v_fee where id = r.user_id;
        if v_holding.quantity - v_qty <= 0.000001 then
          delete from holdings where user_id = r.user_id and stock_code = r.stock_code;
        else
          update holdings set quantity = quantity - v_qty
            where user_id = r.user_id and stock_code = r.stock_code;
        end if;
      end if;

      -- 체결 기록(소급 시각) + 주문 완료 표시
      insert into trades (user_id, stock_code, side, quantity, price, fee, created_at)
        values (r.user_id, r.stock_code, r.side, v_qty, r.limit_price, v_fee, v_fill_time)
        returning id into v_trade_id;
      update orders set status = 'filled', filled_at = v_fill_time,
          filled_price = r.limit_price, filled_qty = v_qty, filled_trade_id = v_trade_id
        where id = r.id;
      v_filled := v_filled + 1;
    exception when others then
      -- 한 건이 실패해도 배치·정산 전체를 막지 않는다
      raise notice 'settle_limit_orders: order % 실패: %', r.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('filled', v_filled, 'expired', v_expired);
end $$;

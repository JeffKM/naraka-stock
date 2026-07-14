-- 지정가 예약주문 (Phase 10 · PRD §4.5, 2026-07-14 그릴 세션 확정)
--
-- 호가창이 아니라 "지정가 예약주문"이다. 참가자 규모가 작아 호가창(잔량 표시)은
-- 보류하고, 유동성·타인 체결이 필요 없는 지정가 예약만 도입한다.
--
-- 핵심 설계 (§4.5):
--  - 체결 트리거 = lazy 소급 정산: 장중 크론 없이, 접근 시(사용자 지정)와 폐장 배치가
--    미체결 주문을 정산한다. 하루치 틱이 이미 daily_ticks에 있으므로 "조건이 닿은
--    과거 틱의 시각·가격"으로 소급 체결 → 언제 정산하든 결정론적으로 동일(공정).
--  - 체결가 = 지정가 고정: 조건 판정(매수 틱≤지정가 / 매도 틱≥지정가)은 "언제
--    체결되나"만 결정하고, 체결가는 항상 지정가 (틱 이산 점프 갭 불로소득 차단).
--  - 예약을 물리적으로 옮기지 않는다: 현금·보유는 그대로 두고 orders에만 기록,
--    "주문가능 = 잔고 − 예약합"으로만 차감. 총자산·랭킹 계산은 수학적으로 불변이고,
--    취소·만료는 상태만 바꾸면 되며(환불 로직 없음), execute_trade(시장가)만 예약분을
--    존중하도록 최소 수정한다(안 하면 시장가가 예약분을 먼저 써버려 예약이 무의미).
--  - 밴드밖(±30%) 차단 / 즉시 충족 지정가는 즉시 시장가 체결 / 정지·서킷 틱 건너뜀 /
--    당일 만료 / 유저당 미체결 10건 상한.
--
-- 돈(cash/price/gross/fee)은 정수(원). 수량만 numeric(20,6). 원칙 3 준수.

-- ---------------------------------------------------------------------------
-- 1) orders 테이블 (T-1001)
-- ---------------------------------------------------------------------------
create table orders (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id) on delete cascade,
  stock_code text not null references stocks (code),
  side text not null check (side in ('buy', 'sell')),
  limit_price bigint not null check (limit_price > 0),
  -- 매수: 예약 금액(정수 원). 매도: null
  reserved_cash bigint check (reserved_cash is null or reserved_cash > 0),
  -- 매도: 예약 수량(소수점). 매수: null
  reserved_qty numeric(20, 6) check (reserved_qty is null or reserved_qty > 0),
  status text not null default 'pending'
    check (status in ('pending', 'filled', 'cancelled', 'expired')),
  order_date date not null, -- 접수일(KST 게임 날짜) — 당일 만료 판정
  created_at timestamptz not null default now(),
  -- 체결 결과 (status='filled'일 때만)
  filled_at timestamptz,        -- 소급 체결 시각 = 조건 닿은 틱 시각
  filled_price bigint,          -- = limit_price (기록 편의)
  filled_qty numeric(20, 6),
  filled_trade_id bigint references trades (id),
  -- side별 예약 컬럼 정합성: 매수는 현금, 매도는 수량만
  constraint orders_reserve_chk check (
    (side = 'buy' and reserved_cash is not null and reserved_qty is null)
    or (side = 'sell' and reserved_qty is not null and reserved_cash is null)
  )
);

-- 유저별 미체결 목록·10건 상한 카운트·예약합 집계
create index orders_user_status_idx on orders (user_id, status);
-- 정산 스캔: 종목·날짜별 미체결만 (부분 인덱스)
create index orders_pending_scan_idx on orders (stock_code, order_date)
  where status = 'pending';

-- 다른 테이블과 동일하게 RLS 전면 차단 (service role만 통과)
-- grant는 init_schema의 alter default privileges로 신규 테이블에 자동 부여됨.
alter table orders enable row level security;
alter table orders force row level security;

-- ---------------------------------------------------------------------------
-- 2) execute_trade 교체: 예약분(pending orders)을 존중하도록 최소 수정 (T-1001)
--    - 매수 가용 = cash − Σ(pending buy 예약금)
--    - 매도 가용 = 보유수량 − Σ(pending sell 예약수량)
--    나머지(장 시간·틱·서킷·VI·소수점 체결)는 fractional_shares.sql과 동일.
-- ---------------------------------------------------------------------------
create or replace function execute_trade(
  p_user_id bigint,
  p_stock_code text,
  p_side text, -- 'buy' | 'sell'
  p_quantity numeric default null, -- 수량 지정 매매(매도 수량모드)
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
  if p_side = 'buy' and p_amount is null then
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

-- ---------------------------------------------------------------------------
-- 3) place_limit_order: 지정가 접수 (T-1002)
--    - 밴드밖(±30%) 차단
--    - 즉시 충족 지정가는 거부 대신 execute_trade 시장가로 즉시 체결(더 유리)
--    - 대기쪽에 걸린 것만 pending 예약(현금·주식 락 = orders 기록)
--    - 유저당 미체결 10건 상한
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
  v_tick := floor(((extract(hour from v_kst) - v_open) * 60 + extract(minute from v_kst)) / 5);

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
-- 4) settle_limit_orders: lazy 소급 정산 (T-1003)
--    - p_user_id null = 전체(폐장 배치), 특정 유저 = 접근 시 정산
--    - 조건 닿은 첫 유효 틱(is_halted=false, tick_index<=현재틱)에서 지정가로 소급 체결
--    - p_final(폐장) = true면 v_today 전체 틱 대상 + 미체결 만료
--    - order_date < v_today 인 잔여 미체결은 항상 만료(안전망)
--    - 활성 서킷브레이커 중(비-final)엔 정산 보류 → 해제 후 소급 처리(결과 동일)
--    ※ 서킷 창 중 틱 스킵은 v1에서 is_halted(VI)만 정밀 처리. 시장 전체 CB 창은
--      config가 최신 until만 보관해 과거 창 재구성이 불가하므로, T-906 경로 재생성에
--      위임하고 여기선 활성 CB 보류로만 방어(§4.5 검증 대상).
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
  v_max_tick := (v_close - v_open) * 12 - 1;

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
    if v_hour < v_open then
      v_cur_tick := -1;
    elsif v_hour >= v_close then
      v_cur_tick := v_max_tick;
    else
      v_cur_tick := floor(((v_hour - v_open) * 60 + v_min) / 5);
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

      -- 소급 체결 시각 = 그 틱의 KST 시각
      v_fill_time := ((r.order_date::timestamp)
        + make_interval(hours => v_open)
        + make_interval(mins => v_fill.tick_index * 5)) at time zone 'Asia/Seoul';

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

-- ---------------------------------------------------------------------------
-- 5) apply_daily_batch 교체: 폐장 정산 단계에 지정가 최종 정산 편입 (T-1003)
--    시그니처·기존 동작 동일, 1.5) 단계만 추가 (배당 전에 정산 → 종가 보유 확정).
-- ---------------------------------------------------------------------------
create or replace function apply_daily_batch(
  p_today date,
  p_settle boolean,
  p_pay_dividend boolean,
  p_dividend_percent int,
  p_tomorrow date,
  p_summaries jsonb,
  p_ticks jsonb,
  p_news jsonb default '[]'
) returns jsonb
language plpgsql
as $$
declare
  v_dividends_paid int := 0;
  v_ticks_inserted int := 0;
  v_news_inserted int := 0;
  v_last_dividend date;
  v_orders jsonb := '{}'::jsonb;
begin
  -- 1) 오늘 정산: 실제 틱에서 OHLC 재계산
  if p_settle then
    insert into daily_summary (stock_code, date, open, high, low, close, bias)
    select t.stock_code, p_today,
      (array_agg(t.price order by t.tick_index asc))[1],
      max(t.price), min(t.price),
      (array_agg(t.price order by t.tick_index desc))[1],
      0
    from daily_ticks t
    where t.date = p_today
    group by t.stock_code
    on conflict (stock_code, date) do update
      set open = excluded.open, high = excluded.high,
          low = excluded.low, close = excluded.close;
  end if;

  -- 1.5) 지정가 예약주문 최종 정산 (폐장) — 미체결은 만료(예약 자동 해제)
  --      배당(2)·익일 경로(3)보다 먼저 실행해 "종가 시점 보유"를 확정한다.
  if p_settle then
    v_orders := settle_limit_orders(null, now(), p_today, true);
  end if;

  -- 2) 금요일 배당 (중복 지급 방지 가드)
  if p_pay_dividend then
    select (value #>> '{}')::date into v_last_dividend
      from config where key = 'last_dividend_date';

    if v_last_dividend is null or v_last_dividend < p_today then
      with payouts as (
        select h.user_id,
          sum(floor(h.quantity * s.close * p_dividend_percent / 100.0))::bigint as amount
        from holdings h
        join stocks st on st.code = h.stock_code and st.tier = 'stable'
        join daily_summary s on s.stock_code = h.stock_code and s.date = p_today
        where h.quantity > 0
        group by h.user_id
      )
      update users u
        set cash = u.cash + p.amount
        from payouts p
        where u.id = p.user_id and p.amount > 0;
      get diagnostics v_dividends_paid = row_count;

      insert into config (key, value)
        values ('last_dividend_date', to_jsonb(p_today::text))
        on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
  end if;

  -- 3) 익일 경로 반영 (재실행 안전)
  if p_tomorrow is not null then
    delete from daily_ticks where date = p_tomorrow;
    delete from daily_summary where date = p_tomorrow;

    insert into daily_summary (stock_code, date, open, high, low, close, bias)
    select x.stock_code, p_tomorrow, x.open, x.high, x.low, x.close, x.bias
    from jsonb_to_recordset(p_summaries)
      as x(stock_code text, open bigint, high bigint, low bigint, close bigint, bias smallint);

    insert into daily_ticks (stock_code, date, tick_index, price, is_halted)
    select x.stock_code, p_tomorrow, x.tick_index, x.price, x.is_halted
    from jsonb_to_recordset(p_ticks)
      as x(stock_code text, tick_index smallint, price bigint, is_halted boolean);
    get diagnostics v_ticks_inserted = row_count;
  end if;

  -- 4) 자동 뉴스 반영 (수동 뉴스 보존)
  if jsonb_array_length(p_news) > 0 then
    delete from news
      where is_auto
        and (
          (grade = 'disclosure' and date in (
            select distinct (x.date)::date
            from jsonb_to_recordset(p_news) as x(date text, grade text)
            where x.grade = 'disclosure'))
          or (grade in ('news', 'rumor') and date in (
            select distinct (x.date)::date
            from jsonb_to_recordset(p_news) as x(date text, grade text)
            where x.grade in ('news', 'rumor')))
        );

    insert into news (date, stock_code, grade, title, body, is_auto, published_at)
    select (x.date)::date, x.stock_code, x.grade, x.title, x.body, true,
      coalesce((x.published_at)::timestamptz, now())
    from jsonb_to_recordset(p_news)
      as x(date text, stock_code text, grade text, title text, body text, published_at text);
    get diagnostics v_news_inserted = row_count;
  end if;

  -- 5) 배치 실행 기록
  insert into config (key, value)
    values ('last_batch_date', to_jsonb(p_today::text))
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object(
    'settled', p_settle,
    'dividendsPaid', v_dividends_paid,
    'ticksInserted', v_ticks_inserted,
    'newsInserted', v_news_inserted,
    'ordersSettled', v_orders
  );
end $$;

-- ---------------------------------------------------------------------------
-- 6) reset_rehearsal_data 교체: 리허설 초기화에 orders 정리 추가 (T-1001)
--    (on delete cascade가 유저 삭제 시 orders를 지우지만, trades/holdings처럼
--     전체 삭제를 명시해 어드민 유저의 잔여 주문까지 초기화한다.)
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

-- 신규 함수 실행 권한 (reschedule_daily_batch 패턴)
grant execute on function place_limit_order(bigint, text, text, bigint, bigint, numeric, timestamptz) to service_role;
grant execute on function settle_limit_orders(bigint, timestamptz, date, boolean) to service_role;

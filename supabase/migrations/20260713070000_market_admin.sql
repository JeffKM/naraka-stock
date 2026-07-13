-- 장 운영 어드민화 (Phase 8)
--
-- 1) 하루 틱 수 가변화: 장 시간이 config로 바뀌면 틱 수도 달라진다
--    (12~22시 = 120틱). daily_ticks 제약을 24시간 상한(288틱)까지 완화.
-- 2) execute_trade: 하드코딩된 15~22시 대신 config 장 시간으로 검증하고,
--    현재 틱이 없으면 마지막 틱으로 폴백 (장 시간 연장 당일의 종가 동결 구간 대응).
-- 3) 운영값 반영 (사장님 확정 2026-07-13): 월·화 개장(정기 휴장 없음), 12시 개장.
-- 4) 리허설 초기화가 장 시간을 15~22시로 되돌리던 동작 제거 — 장 운영
--    설정은 이제 어드민 소관이라 초기화가 건드리지 않는다.

-- 1) 틱 인덱스 제약 완화 (0~287 = 24시간 × 12틱)
alter table daily_ticks drop constraint if exists daily_ticks_tick_index_check;
alter table daily_ticks add constraint daily_ticks_tick_index_check
  check (tick_index between 0 and 287);

-- 2) 체결 함수: config 장 시간 + 마지막 틱 폴백
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
  v_open := coalesce((select (value #>> '{}')::int from config where key = 'market_open_hour'), 15);
  v_close := coalesce((select (value #>> '{}')::int from config where key = 'market_close_hour'), 22);
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

-- 3) 운영값: 정기 휴장 없음(월·화 개장) + 12시 개장
insert into config (key, value) values ('closed_weekdays', '[]')
  on conflict (key) do update set value = excluded.value;
update config set value = '12' where key = 'market_open_hour';

-- 4) 리허설 초기화: 장 시간 되돌리기 제거 (어드민 설정 존중)
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

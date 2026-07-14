-- 소수점 주식 + 금액 기준 체결 (토스 벤치마킹)
--
-- 배경: 지금까지는 정수 "주"만 매매돼 고가 종목일수록 잔돈이 강제로 놀았다
-- (자본 100% 투입 불가 → 종목 선택에 따른 불공정). 실제 증권사처럼 금액을
-- 넣으면 소수점 주식으로 체결되게 바꾼다.
--
-- 원칙: 돈(cash/price/gross/fee)은 여전히 정수(원). 수량만 소수점(numeric)이다.
--   - 매수: 항상 금액(p_amount, 정수 원) 기준. 수량 = trunc(금액/체결가, 6자리).
--           체결액 v_gross = round(수량 × 체결가) ≤ 금액 → 남는 원은 현금에 그대로.
--   - 매도: 수량(p_quantity) 또는 금액(p_amount) 기준. 금액모드에서 보유 평가액을
--           넘는 요청은 전량으로 클램프. 반올림 잔량(<1e-6)은 전량으로 스냅.
-- numeric은 부동소수점이 아니라 정확한 십진수라 아키텍처 원칙 3 위반이 아니다.

-- 1) 수량 컬럼을 정수 → 소수점(6자리)으로 전환. 기존 정수 값은 그대로 보존된다.
alter table holdings alter column quantity type numeric(20, 6);
alter table trades alter column quantity type numeric(20, 6);

-- 2) 체결 함수 교체: 시그니처가 바뀌므로(파라미터 추가·타입 변경) 구본을 먼저 제거.
drop function if exists execute_trade(bigint, text, text, bigint, timestamptz);

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
  v_qty numeric; -- 체결 수량 (소수점 6자리)
  v_gross bigint; -- 체결 대금 (정수 원)
  v_new_qty numeric;
  v_new_avg bigint;
  v_trade_id bigint;
begin
  -- 금액/수량 중 정확히 하나만 지정돼야 한다
  if (p_amount is null) = (p_quantity is null) then
    raise exception 'VALIDATION';
  end if;
  if p_side not in ('buy', 'sell') then
    raise exception 'VALIDATION';
  end if;
  -- 매수는 금액 기준만 허용 (수량 직접 지정 불가 — 소수점 주식은 금액에서 파생)
  if p_side = 'buy' and p_amount is null then
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

  -- 5) 수량/대금 산출 — 수량은 6자리 절사, 대금은 정수 원으로 반올림
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
    -- 6a) 매수: 잔고 검증 → 차감 → 평단 갱신 (대금만큼만 차감, 남는 원은 현금 유지)
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
        values (p_user_id, p_stock_code, v_qty, v_price);
    else
      v_new_qty := v_holding.quantity + v_qty;
      v_new_avg := round(
        (v_holding.quantity * v_holding.avg_price + v_gross) / v_new_qty
      );
      update holdings
        set quantity = v_new_qty, avg_price = v_new_avg
        where user_id = p_user_id and stock_code = p_stock_code;
    end if;
  else
    -- 6b) 매도: 보유량 확정 → 수수료 차감 후 입금 → 보유 감소
    select quantity, avg_price into v_holding
      from holdings
      where user_id = p_user_id and stock_code = p_stock_code
      for update;
    if not found then
      raise exception 'INSUFFICIENT_QUANTITY';
    end if;

    -- 금액모드 초과분·반올림 잔량은 전량으로 스냅
    if p_amount is not null and v_qty > v_holding.quantity then
      v_qty := v_holding.quantity;
    elsif abs(v_holding.quantity - v_qty) <= 0.000001 then
      v_qty := v_holding.quantity;
    end if;
    if v_holding.quantity < v_qty then
      raise exception 'INSUFFICIENT_QUANTITY';
    end if;

    v_gross := round(v_qty * v_price); -- 스냅 반영해 재계산
    v_fee := floor(v_gross * v_fee_bp / 10000.0);
    update users set cash = cash + v_gross - v_fee where id = p_user_id;

    if v_holding.quantity = v_qty then
      delete from holdings where user_id = p_user_id and stock_code = p_stock_code;
    else
      update holdings
        set quantity = quantity - v_qty
        where user_id = p_user_id and stock_code = p_stock_code;
    end if;
  end if;

  -- 7) 체결 기록
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

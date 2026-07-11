-- 일일 배치 원자 반영 함수 (T-204/T-206)
--
-- 경로 생성·편향 추첨 등 난수 로직은 TS 엔진(src/lib/engine/)이 담당하고,
-- 이 함수는 계산 결과를 단일 트랜잭션으로 DB에 반영만 한다.
-- (시뮬레이션과 운영 배치가 같은 TS 엔진 코드를 쓰기 위한 분리 — PRD §9.1)

create or replace function apply_daily_batch(
  p_today date,
  p_settle boolean, -- 오늘 정산(OHLC 확정) 수행 여부 (오늘이 개장일일 때만 true)
  p_pay_dividend boolean, -- 금요일 배당 지급 여부
  p_dividend_percent int, -- 배당률 (%)
  p_tomorrow date, -- 익일 경로 생성 대상 날짜 (익일 휴장이면 null)
  p_summaries jsonb, -- [{stock_code, open, high, low, close, bias}] (익일 잠정 요약)
  p_ticks jsonb -- [{stock_code, tick_index, price, is_halted}] (익일 틱)
) returns jsonb
language plpgsql
as $$
declare
  v_dividends_paid int := 0;
  v_ticks_inserted int := 0;
  v_last_dividend date;
begin
  -- 1) 오늘 정산: 실제 틱에서 OHLC 재계산 (장중 경로 재생성이 있었어도 정확)
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

  -- 2) 금요일 배당: 안정주 보유자에게 종가 기준 p_dividend_percent% 현금 지급
  --    (중복 지급 방지: config.last_dividend_date 가드)
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

  -- 3) 익일 경로 반영: 기존 데이터 삭제 후 재삽입 (배치 재실행에 안전 — 개장 전이므로)
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

  -- 4) 배치 실행 기록
  insert into config (key, value)
    values ('last_batch_date', to_jsonb(p_today::text))
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object(
    'settled', p_settle,
    'dividendsPaid', v_dividends_paid,
    'ticksInserted', v_ticks_inserted
  );
end $$;

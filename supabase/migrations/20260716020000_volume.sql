-- 거래량(volume) 컬럼 추가 및 배치 반영
-- Phase 2 · Feedback (5,6): 틱/요약에 사전 생성 거래량 저장
--
-- 시뮬레이션 거래량 = 시장 거래량(가격과 동일한 사전 생성 경로).
-- 참가자 실제 체결(trades 집계)과는 별개 레이어 → 인기종목 지표 담당.
--
-- 컬럼:
--   - daily_ticks.volume: 해당 틱의 시뮬레이션 거래량
--   - daily_summary.volume: 하루 총 거래량 = Σ(틱 volume)
--
-- 배치:
--   - settle=true: 오늘 틱에서 volume sum을 daily_summary에 기록
--   - tomorrow!=null: 익일 틱/요약을 volume 포함해 삽입

alter table daily_ticks add column if not exists volume bigint not null default 0;
alter table daily_summary add column if not exists volume bigint not null default 0;

-- apply_daily_batch 재정의: 시그니처 동일(jsonb 파라미터 내 컬럼만 확장)
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
  -- 1) 오늘 정산: 실제 틱에서 OHLC + 거래량 합 재계산
  if p_settle then
    insert into daily_summary (stock_code, date, open, high, low, close, bias, volume)
    select t.stock_code, p_today,
      (array_agg(t.price order by t.tick_index asc))[1],
      max(t.price), min(t.price),
      (array_agg(t.price order by t.tick_index desc))[1],
      0,
      coalesce(sum(t.volume), 0)
    from daily_ticks t
    where t.date = p_today
    group by t.stock_code
    on conflict (stock_code, date) do update
      set open = excluded.open, high = excluded.high,
          low = excluded.low, close = excluded.close, volume = excluded.volume;
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

  -- 3) 익일 경로 반영 (재실행 안전, volume 포함)
  if p_tomorrow is not null then
    delete from daily_ticks where date = p_tomorrow;
    delete from daily_summary where date = p_tomorrow;

    insert into daily_summary (stock_code, date, open, high, low, close, bias, volume)
    select x.stock_code, p_tomorrow, x.open, x.high, x.low, x.close, x.bias, x.volume
    from jsonb_to_recordset(p_summaries)
      as x(stock_code text, open bigint, high bigint, low bigint, close bigint, bias smallint, volume bigint);

    insert into daily_ticks (stock_code, date, tick_index, price, is_halted, volume)
    select x.stock_code, p_tomorrow, x.tick_index, x.price, x.is_halted, x.volume
    from jsonb_to_recordset(p_ticks)
      as x(stock_code text, tick_index smallint, price bigint, is_halted boolean, volume bigint);
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

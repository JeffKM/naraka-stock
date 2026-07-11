-- 뉴스 자동 생성 배치 통합 (T-502)
--
-- news.is_auto: 배치가 만든 뉴스 표시 — 배치 재실행 시 자동분만 지우고 다시 넣는다
-- (어드민 수동 뉴스는 보존).

alter table news add column if not exists is_auto boolean not null default false;

-- apply_daily_batch에 뉴스 반영 추가 (시그니처 변경이므로 기존 함수 제거 후 재생성)
drop function if exists apply_daily_batch(date, boolean, boolean, int, date, jsonb, jsonb);

create or replace function apply_daily_batch(
  p_today date,
  p_settle boolean,
  p_pay_dividend boolean,
  p_dividend_percent int,
  p_tomorrow date,
  p_summaries jsonb,
  p_ticks jsonb,
  p_news jsonb default '[]' -- [{date, stock_code, grade, title, body}]
) returns jsonb
language plpgsql
as $$
declare
  v_dividends_paid int := 0;
  v_ticks_inserted int := 0;
  v_news_inserted int := 0;
  v_last_dividend date;
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

  -- 4) 자동 뉴스 반영: 같은 (날짜 × 등급군)의 자동 뉴스만 교체 (수동 뉴스 보존).
  --    등급군을 구분하지 않으면 다음날 배치의 공시 삽입이 그날의 힌트 뉴스를 지워버린다.
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

    insert into news (date, stock_code, grade, title, body, is_auto)
    select (x.date)::date, x.stock_code, x.grade, x.title, x.body, true
    from jsonb_to_recordset(p_news)
      as x(date text, stock_code text, grade text, title text, body text);
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
    'newsInserted', v_news_inserted
  );
end $$;

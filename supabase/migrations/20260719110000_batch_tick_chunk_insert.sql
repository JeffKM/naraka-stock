-- 대량 틱 삽입 청크 분리 (Task 6: 10초 틱 배치 실측 대응)
--
-- 배경: 5분 → 10초 틱 전환으로 p_ticks 페이로드가 종목당 4,320개(42종목 합계 약
-- 181,440개 객체)로 커졌다. 로컬에서 실측한 결과, PostgREST 연결의 로그인 역할인
-- authenticator에 걸린 statement_timeout=8s가 SET ROLE(예: service_role) 이후에도
-- 같은 세션에 남아 있어(역할 전환은 세션 GUC를 초기화하지 않는다), 단일
-- apply_daily_batch 호출 안에서 181,440행을 한 번에 삽입하면
-- "57014 canceling statement due to statement timeout"으로 트랜잭션 전체가
-- 실패한다(앱 레벨 maxDuration=60s에 도달하기 훨씬 전에 DB가 먼저 끊는다).
--
-- 완화책: 틱 "삽입"만 별도 RPC(insert_daily_ticks_chunk)로 분리해 배치 서비스가
-- 청크 단위로 여러 번 호출한다. 정산·배당·요약·뉴스 반영과 "재실행 멱등성을 위한
-- 기존 틱 삭제"는 그대로 apply_daily_batch 안에 남겨 단일 트랜잭션을 유지한다
-- (삭제와 삽입을 분리해도, 삭제가 먼저 커밋되고 이후 청크들이 삽입되므로 배치가
-- 도중에 실패해도 daily_ticks가 "이전 날짜의 stale 데이터 + 일부만 채워진 새 날짜"로
-- 남을 뿐, 재실행하면 다시 삭제 후 전량 재삽입되어 결국 일관 상태로 수렴한다).
--
-- p_ticks 파라미터는 시그니처 하위 호환을 위해 유지하되(호출부가 반드시 넘겨야 함),
-- 더 이상 이 함수 안에서 삽입에 쓰지 않는다 — 배치 서비스가 항상 빈 배열을 넘긴다.
-- 20260719100000_tick_10s.sql 이후의 live 정의(20260717050000_news_source_in_batch.sql
-- 베이스)에서 §3의 daily_ticks insert 블록만 제거했고, 나머지 블록(정산·지정가 정산·
-- 배당·요약·뉴스·config 기록·return)은 100% 동일하다.

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

  -- 3) 익일 경로 반영 (재실행 안전) — 요약만 여기서 반영, 틱은 더 이상 여기서
  --    삽입하지 않는다(청크 페이로드 타임아웃 대응). 삭제는 재실행 멱등성을 위해
  --    그대로 유지 — 이후 insert_daily_ticks_chunk 호출들이 전량 재삽입한다.
  if p_tomorrow is not null then
    delete from daily_ticks where date = p_tomorrow;
    delete from daily_summary where date = p_tomorrow;

    insert into daily_summary (stock_code, date, open, high, low, close, bias, volume)
    select x.stock_code, p_tomorrow, x.open, x.high, x.low, x.close, x.bias, x.volume
    from jsonb_to_recordset(p_summaries)
      as x(stock_code text, open bigint, high bigint, low bigint, close bigint, bias smallint, volume bigint);

    -- p_ticks는 더 이상 여기서 쓰지 않는다(호출부가 청크로 분리 호출).
  end if;

  -- 4) 자동 뉴스 반영 (수동 뉴스 보존) — source 추가
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

    insert into news (date, stock_code, grade, title, body, source, is_auto, published_at)
    select (x.date)::date, x.stock_code, x.grade, x.title, x.body, x.source, true,
      coalesce((x.published_at)::timestamptz, now())
    from jsonb_to_recordset(p_news)
      as x(date text, stock_code text, grade text, title text, body text,
           source text, published_at text);
    get diagnostics v_news_inserted = row_count;
  end if;

  -- 5) 배치 실행 기록
  insert into config (key, value)
    values ('last_batch_date', to_jsonb(p_today::text))
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object(
    'settled', p_settle,
    'dividendsPaid', v_dividends_paid,
    'ticksInserted', v_ticks_inserted, -- 항상 0: 실제 삽입 건수는 청크 RPC 응답 합산으로 서비스가 계산
    'newsInserted', v_news_inserted,
    'ordersSettled', v_orders
  );
end $$;

-- ---------------------------------------------------------------------------
-- 틱 청크 삽입 RPC: apply_daily_batch가 p_tomorrow의 기존 틱을 삭제한 뒤,
-- 배치 서비스가 이 함수를 여러 번(청크당) 호출해 daily_ticks를 채운다.
-- on conflict do update로 재시도·재실행에 안전(같은 청크를 다시 보내도 결과 동일).
-- ---------------------------------------------------------------------------
create or replace function insert_daily_ticks_chunk(
  p_date date,
  p_ticks jsonb
) returns int
language plpgsql
as $$
declare
  v_inserted int := 0;
begin
  insert into daily_ticks (stock_code, date, tick_index, price, is_halted, volume)
  select x.stock_code, p_date, x.tick_index, x.price, x.is_halted, x.volume
  from jsonb_to_recordset(p_ticks)
    as x(stock_code text, tick_index smallint, price bigint, is_halted boolean, volume bigint)
  on conflict (stock_code, date, tick_index) do update
    set price = excluded.price, is_halted = excluded.is_halted, volume = excluded.volume;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

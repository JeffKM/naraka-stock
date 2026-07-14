-- 뉴스 발행 타이밍 개편 (2026-07-14)
--
-- 1) 자동 뉴스에 published_at을 명시적으로 실어 장중 시간차 노출을 지원한다.
--    - 정식뉴스: 익일 경로의 움직임 틱 시각 (장중에 하나씩 풀림)
--    - 공시: 폐장 직전 틱 시각 (폐장 순간부터 노출)
--    피드는 published_at <= now() 로 게이팅하므로 추가 인프라(장중 크론) 없이
--    사전생성 경로처럼 뉴스도 "저절로" 풀린다.
-- 2) 폐장 시각이 어드민 설정을 따라가므로, 배치 크론 스케줄도 폐장 시각에 맞춰
--    자동 재조정한다 (reschedule_daily_batch).

-- ── apply_daily_batch: p_news에 published_at 추가 ───────────────────────────
create or replace function apply_daily_batch(
  p_today date,
  p_settle boolean,
  p_pay_dividend boolean,
  p_dividend_percent int,
  p_tomorrow date,
  p_summaries jsonb,
  p_ticks jsonb,
  p_news jsonb default '[]' -- [{date, stock_code, grade, title, body, published_at}]
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
  --    등급군을 구분하지 않으면 다음날 배치의 공시 삽입이 그날의 정식뉴스를 지워버린다.
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
    'newsInserted', v_news_inserted
  );
end $$;

-- ── reschedule_daily_batch: 폐장 시각에 맞춰 pg_cron 스케줄 재조정 ───────────
-- 어드민이 폐장 시각(market_close_hour)을 바꾸면 앱이 이 함수를 호출한다.
-- cron.alter_job으로 스케줄 문자열만 교체하므로 실행 커맨드(URL·시크릿)는 보존된다.
-- pg_cron 미설치(로컬)이거나 잡 미등록(최초 배포 전)이면 조용히 건너뛴다.
create or replace function reschedule_daily_batch()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_close int;
  v_utc int;
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return; -- 로컬 등 pg_cron 없는 환경
  end if;

  select (value #>> '{}')::int into v_close from config where key = 'market_close_hour';
  if v_close is null then
    v_close := 22;
  end if;

  -- KST(UTC+9) 폐장 시각 → UTC 시(0~23). 폐장 24시면 UTC 15시(=다음 날 00:00 KST).
  v_utc := (((v_close - 9) % 24) + 24) % 24;

  execute 'select jobid from cron.job where jobname = $1' into v_jobid using 'naraka-daily-batch';
  if v_jobid is null then
    return; -- 잡이 아직 등록 안 됨 (최초 배포 시 DEPLOY.md 절차로 수동 등록)
  end if;

  execute 'select cron.alter_job(job_id := $1, schedule := $2)'
    using v_jobid, format('0 %s * * *', v_utc);
end $$;

grant execute on function reschedule_daily_batch() to service_role;

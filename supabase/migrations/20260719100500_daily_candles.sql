-- daily_candles: 10초 틱 → 5분 OHLC 사전 집계 (Task 5)
--
-- 배경: 10초 틱 전환(Task 4) 이후 하루 종목당 틱 수가 최대 4,320개(24시간 기준)까지
-- 늘어난다. 차트가 daily_ticks를 종목 전체(8~42종목) 범위로 직접 읽으면 PostgREST
-- max_rows(1000) 페이지네이션에 걸린다(참고: postgrest-max-rows-1000-tick-pagination
-- 메모). 배치가 폐장 후 10초틱 30개(=5분, TICKS_PER_CANDLE)씩 OHLC로 묶어
-- daily_candles(종목·날짜당 ~144행)에 사전 집계해두고, 차트는 이 테이블만 읽는다.

-- ---------------------------------------------------------------------------
-- 1) 테이블 생성
-- ---------------------------------------------------------------------------
create table if not exists daily_candles (
  stock_code text not null references stocks (code),
  date date not null,
  bucket smallint not null,          -- 5분 버킷 (0 ~ 143)
  open bigint not null check (open > 0),
  high bigint not null check (high > 0),
  low bigint not null check (low > 0),
  close bigint not null check (close > 0),
  volume bigint not null default 0,
  primary key (stock_code, date, bucket)
);
create index if not exists daily_candles_date_bucket_idx on daily_candles (date, bucket);

-- ---------------------------------------------------------------------------
-- 2) 집계 함수 (버킷 = 30틱)
-- ---------------------------------------------------------------------------
-- 10초 틱 30개(5분)를 OHLC로 집계해 daily_candles에 upsert
create or replace function build_daily_candles(p_stock_code text, p_date date)
returns void
language sql
as $$
  insert into daily_candles (stock_code, date, bucket, open, high, low, close, volume)
  select
    p_stock_code,
    p_date,
    (tick_index / 30)::smallint as bucket,
    (array_agg(price order by tick_index))[1]                       as open,
    max(price)                                                      as high,
    min(price)                                                      as low,
    (array_agg(price order by tick_index desc))[1]                  as close,
    coalesce(sum(volume), 0)                                        as volume
  from daily_ticks
  where stock_code = p_stock_code and date = p_date
  group by (tick_index / 30)
  on conflict (stock_code, date, bucket) do update
    set open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, volume = excluded.volume;
$$;

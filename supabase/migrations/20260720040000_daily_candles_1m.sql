-- daily_candles 1분봉 전환: 집계 버킷 30틱(5분) → 6틱(1분)
--
-- 배경: 10초 틱 이점을 차트에서 살리기 위해 기본 캔들 해상도를 5분 → 1분으로
-- 내린다(설계: docs/superpowers/specs/2026-07-20-intraday-1m-live-chart-design.md).
-- build_daily_candles의 버킷 폭만 /30 → /6으로 바꾸고, 나머지 로직(upsert +
-- 고아 버킷 삭제, 20260719150000_candles_orphan_cleanup.sql)은 그대로 보존한다.
-- 6 = TICKS_PER_CANDLE(=CANDLE_INTERVAL_MINUTES 1분 × 60초 / TICK_INTERVAL_SECONDS 10초).
create or replace function build_daily_candles(p_stock_code text, p_date date)
returns void
language sql
as $$
  insert into daily_candles (stock_code, date, bucket, open, high, low, close, volume)
  select
    p_stock_code,
    p_date,
    (tick_index / 6)::smallint as bucket,
    (array_agg(price order by tick_index))[1]                       as open,
    max(price)                                                      as high,
    min(price)                                                      as low,
    (array_agg(price order by tick_index desc))[1]                  as close,
    coalesce(sum(volume), 0)                                        as volume
  from daily_ticks
  where stock_code = p_stock_code and date = p_date
  group by (tick_index / 6)
  on conflict (stock_code, date, bucket) do update
    set open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, volume = excluded.volume;

  -- 뒷받침 틱이 없어진 고아 버킷 삭제 (틱이 줄어든 재조정/장시간 단축 시)
  delete from daily_candles dc
   where dc.stock_code = p_stock_code and dc.date = p_date
     and not exists (
       select 1 from daily_ticks t
       where t.stock_code = p_stock_code and t.date = p_date
         and (t.tick_index / 6)::smallint = dc.bucket
     );
$$;

-- 기존 5분 버킷 캔들은 버킷 폭이 달라 그대로 두면 차트가 깨진다. 전량 삭제 후,
-- raw 틱이 아직 남아 있는 날(prune_old_ticks가 3일 보존)만 1분 버킷으로 재빌드.
-- 3일보다 오래된 날은 장중 캔들 노출창(INTRADAY_CANDLE_DAYS=3) 밖이라 무해하고,
-- 일봉(daily_summary)은 별도 테이블이라 영향 없다.
delete from daily_candles;
do $$
declare r record;
begin
  for r in select distinct stock_code, date from daily_ticks loop
    perform build_daily_candles(r.stock_code, r.date);
  end loop;
end $$;

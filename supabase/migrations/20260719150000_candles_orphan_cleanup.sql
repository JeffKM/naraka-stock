-- build_daily_candles 고아 버킷 정리 (Task 17 리뷰 반영)
--
-- 배경: build_daily_candles는 upsert-only라, 대상 (종목,날짜)의 daily_ticks가
-- 줄어든 경우(예: 어드민이 장 시간을 단축해 reconcileTodayTicks가 뒤쪽 틱을
-- 잘라냄) 더 이상 뒷받침 틱이 없는 고아 캔들 버킷이 daily_candles에 남아
-- 차트에 stale 트레일링 캔들로 노출된다. 기존 upsert 로직은 그대로 두고,
-- 뒷받침 틱이 없는 버킷을 지우는 delete를 추가해 캔들이 틱과 항상 일치하게 한다.
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

  -- 뒷받침 틱이 없어진 고아 버킷 삭제 (틱이 줄어든 재조정/장시간 단축 시)
  delete from daily_candles dc
   where dc.stock_code = p_stock_code and dc.date = p_date
     and not exists (
       select 1 from daily_ticks t
       where t.stock_code = p_stock_code and t.date = p_date
         and (t.tick_index / 30)::smallint = dc.bucket
     );
$$;

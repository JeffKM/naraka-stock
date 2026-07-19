-- 전환 이전(5분 틱) 날짜의 캔들 버킷팅 보정.
--
-- 배경: backfill 마이그레이션(20260720000000)이 모든 날짜에 build_daily_candles와
-- 동일한 tick_index/30(= 10초 틱 30개가 5분 버킷 하나) 산식을 적용했다. 그런데
-- 전환 이전 날짜는 5분 틱(하루 ~144틱)이라, tick_index/30이 하루를 버킷 0~4(5개)로
-- 뭉개 차트가 12:00~12:20 토막으로만 보였다.
--
-- 5분 틱은 1틱 자체가 5분 캔들이므로 bucket=tick_index가 옳다. 10초 틱 날짜(하루
-- 수천 틱)는 이미 tick_index/30으로 올바르므로 건드리지 않는다 — 날짜 하드코딩 대신
-- max(tick_index)로 granularity를 식별한다(5분 하루 최대 ~287 << 10초 하루 4,319).
-- 이 임계값(1000)은 두 granularity를 안전히 가른다. 멱등(재적용해도 동일 결과).
with fivemin_days as (
  select stock_code, date
  from daily_ticks
  group by stock_code, date
  having max(tick_index) < 1000
)
delete from daily_candles dc
using fivemin_days f
where dc.stock_code = f.stock_code and dc.date = f.date;

insert into daily_candles (stock_code, date, bucket, open, high, low, close, volume)
select t.stock_code, t.date, t.tick_index::smallint, t.price, t.price, t.price, t.price, coalesce(t.volume, 0)
from daily_ticks t
where (t.stock_code, t.date) in (
  select stock_code, date
  from daily_ticks
  group by stock_code, date
  having max(tick_index) < 1000
)
on conflict (stock_code, date, bucket) do update
  set open = excluded.open, high = excluded.high, low = excluded.low,
      close = excluded.close, volume = excluded.volume;

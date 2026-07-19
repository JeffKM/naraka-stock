-- 10초 틱 전환 부트스트랩: 마이그레이션 시점에 이미 존재하는 daily_ticks(전환 이전
-- 5분 틱 데이터 포함)에 대해 daily_candles를 한 번 backfill한다.
--
-- 배경: loadDayLastTicks(tickService)·차트·시세판이 daily_candles를 소스로 쓰도록
-- 바뀌었는데, 전환 직후에는 과거 틱-일에 캔들이 없어 loadDayLastTicks가
-- "틱은 있는데 캔들 없음"으로 판단해 throw한다(첫 부트스트랩 배치 500). 이를
-- 막기 위해 기존 전 틱-일의 캔들을 build_daily_candles와 동일 산식으로 채운다.
--
-- 멱등: on conflict do update. 이후 배치는 청크 삽입 후 build_daily_candles로
-- 정상 유지되므로 이 backfill은 일회성 전환 보정이다. 미래 날짜 캔들이 생겨도
-- 서비스 게이팅(date<=today·완료 버킷)이 노출을 막는다.
insert into daily_candles (stock_code, date, bucket, open, high, low, close, volume)
select
  stock_code,
  date,
  (tick_index / 30)::smallint as bucket,
  (array_agg(price order by tick_index))[1] as open,
  max(price) as high,
  min(price) as low,
  (array_agg(price order by tick_index desc))[1] as close,
  coalesce(sum(volume), 0) as volume
from daily_ticks
group by stock_code, date, (tick_index / 30)
on conflict (stock_code, date, bucket) do update
  set open = excluded.open, high = excluded.high, low = excluded.low,
      close = excluded.close, volume = excluded.volume;

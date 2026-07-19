-- config의 tick_interval_minutes 死설정 정리 (Task 21 최종 리뷰 반영)
--
-- 배경: 20260713000000_reference_data.sql이 심어둔 ('tick_interval_minutes', '5')는
-- 10초 틱 전환(20260719100000_tick_10s.sql, Task 4)에서 코드가 실제 틱 간격을
-- src/lib/market.ts의 TICK_INTERVAL_SECONDS 상수(10)로만 참조하도록 바뀌면서
-- DB config 어디서도 읽지 않는 死설정이 됐다. 값이 "5분"으로 그대로 남아 있으면
-- 운영진이 config 테이블만 보고 틱 간격을 오인할 위험이 있어, 키·값을 실제
-- 운영값(10초)과 일치시켜 둔다. 기존 마이그레이션(20260713000000)은 수정하지 않고
-- 신규 마이그레이션으로 갱신한다.
update config
  set key = 'tick_interval_seconds', value = '10'
  where key = 'tick_interval_minutes';

-- 위 update가 대상을 못 찾는 경우(예: 이미 정리된 환경)를 대비해 최종 상태를 보장
insert into config (key, value)
  select 'tick_interval_seconds', '10'
  where not exists (select 1 from config where key = 'tick_interval_seconds')
on conflict (key) do nothing;

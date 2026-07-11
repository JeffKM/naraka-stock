-- 어드민 기능 (T-604): 깜짝 이벤트 — 오늘 경로의 남은 틱을 원자적으로 교체

create or replace function replace_future_ticks(
  p_stock_code text,
  p_date date,
  p_from_tick int, -- 이 틱 인덱스 초과분을 교체
  p_ticks jsonb -- [{tick_index, price, is_halted}]
) returns int
language plpgsql
as $$
declare
  v_inserted int;
begin
  delete from daily_ticks
    where stock_code = p_stock_code and date = p_date and tick_index > p_from_tick;

  insert into daily_ticks (stock_code, date, tick_index, price, is_halted)
  select p_stock_code, p_date, x.tick_index, x.price, x.is_halted
  from jsonb_to_recordset(p_ticks)
    as x(tick_index smallint, price bigint, is_halted boolean);
  get diagnostics v_inserted = row_count;

  return v_inserted;
end $$;

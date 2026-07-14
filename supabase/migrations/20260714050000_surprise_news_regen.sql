-- 시세 조정 뉴스 정합화 (2026-07-14)
--
-- 배경: 어드민 시세 조정(triggerSurpriseEvent)은 조정 시점 이후 오늘 틱을 새 경로로
--   덮어쓰지만, 어제 배치가 원래 경로 기준으로 미리 스탬프해 둔 정식뉴스는 그대로
--   남아 예정대로 발행된다 → 뉴스가 설명하려던 움직임이 사라져 차트와 어긋난다.
--
-- 처리: 틱 교체와 같은 트랜잭션에서
--   1) 조정 시점 이후(아직 노출 전) 자동 정식뉴스(grade='news') 무효화
--      - 공시(disclosure): 폐장 배치가 최종 틱에서 재계산하므로 건드리지 않음
--      - 찌라시(rumor): is_auto=false(수동)라 필터로 보존
--   2) 창(admin bias) 이후 꼬리(resumeBias) 구간 기준으로 재생성한 뉴스를 삽입
--      (창 구간은 어드민 수동 찌라시가 서사를 담당하므로 자동뉴스 없음)
--
-- 반환 타입을 int → jsonb로 바꾸므로 기존 함수를 drop 후 재생성한다.

drop function if exists replace_future_ticks(text, date, int, jsonb);

create or replace function replace_future_ticks(
  p_stock_code text,
  p_date date,
  p_from_tick int, -- 이 틱 인덱스 초과분을 교체
  p_ticks jsonb, -- [{tick_index, price, is_halted}]
  p_news_cutoff timestamptz default null, -- 이 시각 초과 자동 정식뉴스 무효화 (null=건너뜀)
  p_new_news jsonb default '[]' -- [{grade, title, body, published_at}] — 꼬리 재생성 뉴스
) returns jsonb
language plpgsql
as $$
declare
  v_inserted int;
  v_voided int := 0;
  v_added int := 0;
begin
  -- 1) 남은 틱 원자 교체
  delete from daily_ticks
    where stock_code = p_stock_code and date = p_date and tick_index > p_from_tick;

  insert into daily_ticks (stock_code, date, tick_index, price, is_halted)
  select p_stock_code, p_date, x.tick_index, x.price, x.is_halted
  from jsonb_to_recordset(p_ticks)
    as x(tick_index smallint, price bigint, is_halted boolean);
  get diagnostics v_inserted = row_count;

  -- 2) 덮어쓴 구간의 아직 노출 안 된 자동 정식뉴스 무효화 (공시·수동 찌라시 보존)
  if p_news_cutoff is not null then
    delete from news
      where stock_code = p_stock_code
        and date = p_date
        and is_auto
        and grade = 'news'
        and published_at > p_news_cutoff;
    get diagnostics v_voided = row_count;
  end if;

  -- 3) 꼬리 구간 재생성 뉴스 삽입 (is_auto=true라 폐장 배치 재실행 시 정상 교체)
  if jsonb_array_length(p_new_news) > 0 then
    insert into news (date, stock_code, grade, title, body, is_auto, published_at)
    select p_date, p_stock_code, x.grade, x.title, x.body, true, (x.published_at)::timestamptz
    from jsonb_to_recordset(p_new_news)
      as x(grade text, title text, body text, published_at text);
    get diagnostics v_added = row_count;
  end if;

  return jsonb_build_object(
    'replaced', v_inserted,
    'newsVoided', v_voided,
    'newsAdded', v_added
  );
end $$;

-- replace_future_ticks에 거래량(volume) 반영 (Task B2)
--
-- 배경: 20260716020000_volume.sql이 daily_ticks.volume 컬럼(not null default 0)을
--   추가하고 apply_daily_batch(폐장 배치 경로)는 volume을 반영하도록 갱신했지만,
--   어드민 수동 재생성 경로(시세 조정 triggerSurpriseEvent, 장 시간 변경 reconcile,
--   신규 상장 createStock)가 공유하는 replace_future_ticks는 그대로 남아 p_ticks의
--   volume 필드를 무시했다 → 재생성된 틱은 전부 volume=0으로 들어가 거래량
--   히스토그램이 끊긴다.
--
-- 처리: p_ticks jsonb 레코드 캐스팅과 insert 컬럼 목록에 volume을 추가한다.
--   함수 시그니처(파라미터 타입·반환 타입)는 그대로라 drop 없이 create or replace로
--   충분하다. 혹시 volume 필드가 누락된 호출이 있어도 깨지지 않도록 coalesce(...,0).

create or replace function replace_future_ticks(
  p_stock_code text,
  p_date date,
  p_from_tick int, -- 이 틱 인덱스 초과분을 교체
  p_ticks jsonb, -- [{tick_index, price, is_halted, volume}]
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

  insert into daily_ticks (stock_code, date, tick_index, price, is_halted, volume)
  select p_stock_code, p_date, x.tick_index, x.price, x.is_halted, coalesce(x.volume, 0)
  from jsonb_to_recordset(p_ticks)
    as x(tick_index smallint, price bigint, is_halted boolean, volume bigint);
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

  -- daily_summary.volume은 여기서 갱신하지 않는다 — apply_daily_batch의 settle
  -- 단계(다음 배치)가 daily_ticks.volume 합으로 다시 계산하므로(20260716020000_volume.sql
  -- 참고), 재생성 시점에는 daily_ticks만 정합이면 충분하다.

  return jsonb_build_object(
    'replaced', v_inserted,
    'newsVoided', v_voided,
    'newsAdded', v_added
  );
end $$;

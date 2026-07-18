-- 주간 배지 스냅샷·정산 함수 + reset_rehearsal_data 갱신
-- 스펙: docs/superpowers/specs/2026-07-18-weekly-badges-design.md

-- ── 1) 일별 총자산 스냅샷 ─────────────────────────────────────────────────────
-- 일별 총자산 스냅샷: 폐장 배치가 매 개장일 호출. 재실행 안전(upsert).
-- 총자산 = cash + Σ(보유수량 × 당일 종가). daily_summary.close 사용.
create or replace function snapshot_user_assets(p_date date)
returns int language plpgsql as $$
declare v_count int;
begin
  insert into user_asset_snapshots (user_id, date, total_asset)
  select u.id, p_date,
         u.cash + coalesce(sum(h.quantity * ds.close), 0)
  from users u
  left join holdings h on h.user_id = u.id and h.quantity > 0
  left join daily_summary ds on ds.stock_code = h.stock_code and ds.date = p_date
  where u.is_admin = false and u.is_banned = false
  group by u.id, u.cash
  on conflict (user_id, date) do update set total_asset = excluded.total_asset;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ── 2) 주간 정산 ──────────────────────────────────────────────────────────────
-- 주간 정산: 그 주 마지막 개장일(p_week_end) 폐장 배치가 호출.
-- p_week_start ~ p_week_end(KST 날짜) 데이터로 12종 승자 산출 후 삽입.
-- 멱등: 이 주차 기존 수여를 지우고 재삽입(배치 재실행 안전).
create or replace function settle_weekly_badges(p_week_start date, p_week_end date)
returns int language plpgsql as $$
declare v_count int;
begin
  delete from weekly_badge_awards where week_start = p_week_start;

  -- (A) 유저별 마감 총자산 (p_week_end 종가 기준)
  create temp table _tot on commit drop as
  select u.id as user_id, u.cash, u.created_at,
         u.cash + coalesce(sum(h.quantity * ds.close), 0) as total_asset,
         coalesce(sum(h.quantity * ds.close), 0) as eval_total
  from users u
  left join holdings h on h.user_id = u.id and h.quantity > 0
  left join daily_summary ds on ds.stock_code = h.stock_code and ds.date = p_week_end
  where u.is_admin = false and u.is_banned = false
  group by u.id, u.cash, u.created_at;

  -- (B) 유저별 주간 매매 횟수/대금 (KST 날짜로 절단)
  create temp table _trade on commit drop as
  select user_id,
         count(*) as trade_count,
         coalesce(sum(price * quantity), 0) as trade_amount
  from trades
  where (created_at at time zone 'Asia/Seoul')::date between p_week_start and p_week_end
  group by user_id;

  -- (C) 유저별 보유 종목 평가수익률 (마감 보유분)
  create temp table _stockret on commit drop as
  select h.user_id, h.stock_code,
         (ds.close - h.avg_price)::numeric / h.avg_price as ret,
         h.quantity * ds.close as eval
  from holdings h
  join daily_summary ds on ds.stock_code = h.stock_code and ds.date = p_week_end
  where h.quantity > 0 and h.avg_price > 0;

  -- (D) 유저별 계열 평가자산 + 주간 계열 매매횟수
  create temp table _char on commit drop as
  select h.user_id, s.owner_character as ch,
         sum(h.quantity * ds.close) as char_eval
  from holdings h
  join stocks s on s.code = h.stock_code and s.owner_character is not null
  join daily_summary ds on ds.stock_code = h.stock_code and ds.date = p_week_end
  where h.quantity > 0
  group by h.user_id, s.owner_character;

  create temp table _chartrade on commit drop as
  select t.user_id, s.owner_character as ch, count(*) as ct
  from trades t
  join stocks s on s.code = t.stock_code and s.owner_character is not null
  where (t.created_at at time zone 'Asia/Seoul')::date between p_week_start and p_week_end
  group by t.user_id, s.owner_character;

  -- (E) 주간 자산 고점/저점 (일별 스냅샷 max/min, 달성일 이른 순)
  create temp table _hl on commit drop as
  select s.user_id,
         max(s.total_asset) as wk_high,
         min(s.total_asset) as wk_low,
         (array_agg(s.date order by s.total_asset desc, s.date asc))[1] as high_date,
         (array_agg(s.date order by s.total_asset asc, s.date asc))[1] as low_date
  from user_asset_snapshots s
  where s.date between p_week_start and p_week_end
  group by s.user_id;

  -- (F) VIP 합계 (출석 + 매장 방문)
  create temp table _vip on commit drop as
  select user_id, count(*) as cnt from (
    select user_id, date from attendance_claims
      where date between p_week_start and p_week_end
    union all
    select user_id, date from visit_claims
      where date between p_week_start and p_week_end
  ) x group by user_id;

  -- ── 삽입: 자산/수익 4종 ──────────────────────────────────────────────────
  insert into weekly_badge_awards (week_start, badge_id, user_id, metric_value)
  select p_week_start, 'wk-god-of-stock', t.user_id, t.total_asset
  from _tot t
  left join _trade tr on tr.user_id = t.user_id
  order by t.total_asset desc, coalesce(tr.trade_count,0) desc, t.created_at asc
  limit 1;

  insert into weekly_badge_awards (week_start, badge_id, user_id, metric_value)
  select p_week_start, 'wk-stock-child', t.user_id, t.total_asset
  from _tot t
  left join _trade tr on tr.user_id = t.user_id
  order by t.total_asset asc, coalesce(tr.trade_count,0) desc, t.created_at asc
  limit 1;

  -- 도파민: 유저별 최고 수익률 종목 → 전체 최고
  insert into weekly_badge_awards (week_start, badge_id, user_id, metric_value)
  select p_week_start, 'wk-dopamine-emperor', r.user_id, r.ret
  from (
    select distinct on (user_id) user_id, ret, eval
    from _stockret order by user_id, ret desc, eval desc
  ) r
  order by r.ret desc, r.eval desc
  limit 1;

  -- 펜트하우스: 유저별 최저 수익률 종목 → 전체 최저
  insert into weekly_badge_awards (week_start, badge_id, user_id, metric_value)
  select p_week_start, 'wk-penthouse-lord', r.user_id, r.ret
  from (
    select distinct on (user_id) user_id, ret, eval
    from _stockret order by user_id, ret asc, eval desc
  ) r
  order by r.ret asc, r.eval desc
  limit 1;

  -- ── 삽입: 계좌변동/스토리 3종 ────────────────────────────────────────────
  -- 기부천사: (고점-마감)/고점 최대 (낙폭)
  insert into weekly_badge_awards (week_start, badge_id, user_id, metric_value)
  select p_week_start, 'wk-donation-angel', h.user_id,
         (h.wk_high - t.total_asset)::numeric / nullif(h.wk_high, 0)
  from _hl h
  join _tot t on t.user_id = h.user_id
  where h.wk_high > 0
  order by (h.wk_high - t.total_asset)::numeric / nullif(h.wk_high, 0) desc,
           h.high_date asc, t.total_asset desc
  limit 1;

  -- 돈복사기: (마감-저점)/저점 최대 (상승)
  insert into weekly_badge_awards (week_start, badge_id, user_id, metric_value)
  select p_week_start, 'wk-money-copier', h.user_id,
         (t.total_asset - h.wk_low)::numeric / nullif(h.wk_low, 0)
  from _hl h
  join _tot t on t.user_id = h.user_id
  where h.wk_low > 0
  order by (t.total_asset - h.wk_low)::numeric / nullif(h.wk_low, 0) desc,
           h.low_date asc, t.total_asset desc
  limit 1;

  -- 인간매크로: 매매횟수 1위
  insert into weekly_badge_awards (week_start, badge_id, user_id, metric_value)
  select p_week_start, 'wk-human-macro', tr.user_id, tr.trade_count
  from _trade tr
  join _tot t on t.user_id = tr.user_id
  order by tr.trade_count desc, tr.trade_amount desc, t.total_asset desc
  limit 1;

  -- ── 삽입: VIP (동점 전원) ────────────────────────────────────────────────
  insert into weekly_badge_awards (week_start, badge_id, user_id, metric_value)
  select p_week_start, 'wk-vip-member', v.user_id, v.cnt
  from _vip v
  where v.cnt = (select max(cnt) from _vip) and v.cnt > 0;

  -- ── 삽입: 캐릭터 최대주주 4종 ────────────────────────────────────────────
  insert into weekly_badge_awards (week_start, badge_id, user_id, metric_value)
  select p_week_start, 'wk-major-' || c.ch, c.user_id, c.char_eval
  from (
    select distinct on (ch) ch, user_id, char_eval
    from (
      select c.ch, c.user_id, c.char_eval,
             c.char_eval::numeric / nullif(t.eval_total, 0) as weight,
             coalesce(ct.ct, 0) as ctrade
      from _char c
      join _tot t on t.user_id = c.user_id
      left join _chartrade ct on ct.user_id = c.user_id and ct.ch = c.ch
    ) z
    order by ch, char_eval desc, weight desc, ctrade desc
  ) c;

  select count(*) into v_count from weekly_badge_awards where week_start = p_week_start;
  return v_count;
end $$;

-- ── 3) reset_rehearsal_data 갱신 ──────────────────────────────────────────────
-- 최신 정의(20260718060000_attendance_streak.sql)를 베이스로
-- weekly_badge_awards / user_asset_snapshots delete 2줄만 추가한 전체 재정의.
-- users.representative_badge_id는 on delete set null이라 users 삭제 시 자동 정리.
create or replace function reset_rehearsal_data(p_baseline_date date)
returns jsonb
language plpgsql
as $$
declare
  v_users int;
  v_trades int;
  v_ticks int;
  v_news int;
begin
  -- 주의: Supabase API 세션은 WHERE 없는 DELETE를 차단(pg-safeupdate)하므로
  -- 전체 삭제에도 where true를 명시한다
  select count(*) into v_trades from trades;
  delete from orders where true;
  delete from trades where true;
  delete from holdings where true;
  delete from weekly_badge_awards where true;
  delete from user_asset_snapshots where true;
  delete from visit_claims where true;
  delete from attendance_claims where true;

  -- 유저 참조 정리 (reset 함수 이후 추가된 테이블 — NO ACTION FK라 users 삭제 전 선제거).
  -- signup_requests는 signup_codes.code를 참조하므로 signup_codes 삭제보다도 먼저 지운다.
  delete from cash_adjustments where true;
  delete from signup_requests where true;

  -- 일반 유저가 쓴 가입 코드는 기록째 제거 (재사용 방지)
  delete from signup_codes
    where used_by in (select id from users where not is_admin);

  select count(*) into v_users from users where not is_admin;
  delete from users where not is_admin;

  select count(*) into v_ticks from daily_ticks;
  delete from daily_ticks where true;
  delete from daily_summary where date <> p_baseline_date;
  delete from index_history where true;

  select count(*) into v_news from news;
  delete from news where true;

  -- 배치·배당·서킷브레이커 상태 초기화 (장 운영 설정은 유지)
  delete from config
    where key in ('last_dividend_date', 'last_batch_date', 'circuit_breaker_until');

  return jsonb_build_object(
    'usersDeleted', v_users,
    'tradesDeleted', v_trades,
    'ticksDeleted', v_ticks,
    'newsDeleted', v_news
  );
end $$;

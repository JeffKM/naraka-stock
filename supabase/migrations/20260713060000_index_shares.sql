-- 발행주식수 + 시장 지수 (나스피/나스닥) — Phase 8
--
-- 지수 = Σ(현재가 × 발행주식수) / divisor (시총가중 체인)
--   나스피(NASPI) = 우량주 + 일반주 / 나스닥(NASDAK) = 테마주
-- divisor는 기준일(2026-07-31) 기준가에서 지수가 1,000pt가 되도록 부트스트랩.
-- 신규 상장·등급 변경으로 구성 종목이 바뀔 땐 지수 값이 연속되도록 서버가
-- divisor를 재보정한다 (src/services/indexService.ts).

alter table stocks
  add column shares_outstanding bigint not null default 10000000
  check (shares_outstanding > 0);

-- 현실형 시총 분포: 우량주가 시장을 압도 (사장님 확정 2026-07-13)
update stocks set shares_outstanding = 50000000 where code = 'NRKE'; -- 6.40조
update stocks set shares_outstanding = 40000000 where code = 'OKJA'; -- 4.20조
update stocks set shares_outstanding = 12000000 where code = 'MERU'; -- 8,160억
update stocks set shares_outstanding = 10000000 where code = 'NRKS'; -- 6,200억
update stocks set shares_outstanding =  8000000 where code = 'NRKM'; -- 3,600억
update stocks set shares_outstanding = 15000000 where code = 'BNZN'; -- 5,700억
update stocks set shares_outstanding = 30000000 where code = 'MIHO'; -- 5,400억
update stocks set shares_outstanding = 50000000 where code = 'NRKB'; -- 3,200억

-- 지수 정의 (divisor는 numeric — 지수 계산은 표시용이라 정수 규칙 예외)
create table market_indices (
  code text primary key,
  name text not null,
  divisor numeric not null check (divisor > 0)
);

-- 지수 일별 종가 (배치가 정산 시 기록 — 전일 대비 등락률의 기준)
create table index_history (
  index_code text not null references market_indices (code),
  date date not null,
  close numeric not null check (close > 0),
  primary key (index_code, date)
);

alter table market_indices enable row level security;
alter table market_indices force row level security;
alter table index_history enable row level security;
alter table index_history force row level security;

-- 기준일 기준가에서 지수 1,000pt가 되도록 divisor 부트스트랩
insert into market_indices (code, name, divisor)
select
  case when s.tier = 'wild' then 'NASDAK' else 'NASPI' end,
  case when s.tier = 'wild' then '나스닥' else '나스피' end,
  sum(ds.close::numeric * s.shares_outstanding) / 1000
from stocks s
join daily_summary ds on ds.stock_code = s.code and ds.date = '2026-07-31'
where s.listed
group by 1, 2;

-- 리허설 초기화에 지수 이력 삭제 추가 (divisor는 구성 변경이 없는 한 유지)
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
  delete from trades where true;
  delete from holdings where true;
  delete from visit_claims where true;

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

  -- 배치·배당·서킷브레이커 상태 초기화 + 장 시간 정식값 보정
  delete from config
    where key in ('last_dividend_date', 'last_batch_date', 'circuit_breaker_until');
  update config set value = '15' where key = 'market_open_hour';
  update config set value = '22' where key = 'market_close_hour';

  return jsonb_build_object(
    'usersDeleted', v_users,
    'tradesDeleted', v_trades,
    'ticksDeleted', v_ticks,
    'newsDeleted', v_news
  );
end $$;

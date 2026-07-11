-- 나라카 증권거래소 — 초기 스키마 (PRD §9.2)
--
-- 설계 원칙:
-- - 모든 자산·가격은 정수(원) — bigint, 부동소수점 금지
-- - date 컬럼은 KST 기준 "게임 날짜" (배치가 Asia/Seoul 기준으로 기록)
-- - 커스텀 인증: 클라이언트는 DB에 직접 접근하지 않음 (RLS 전면 차단, service role만 통과)

-- ---------------------------------------------------------------------------
-- 유저·인증
-- ---------------------------------------------------------------------------

create table users (
  id bigint generated always as identity primary key,
  nickname text not null unique check (char_length(nickname) between 2 and 8),
  password_hash text not null,
  cash bigint not null default 1000000 check (cash >= 0), -- 초기 자금 1,000,000원
  is_admin boolean not null default false,
  is_banned boolean not null default false,
  created_at timestamptz not null default now()
);

-- 매장 발급 1회용 가입 코드
create table signup_codes (
  code text primary key,
  used_by bigint references users (id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- 방문 보너스: 날짜별 코드 (매일 교체, 매장 게시)
create table visit_codes (
  date date primary key,
  code text not null unique
);

-- 방문 보너스 수령 기록 (계정당 1일 1회 — PK로 강제)
create table visit_claims (
  user_id bigint not null references users (id),
  date date not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- ---------------------------------------------------------------------------
-- 종목·시세
-- ---------------------------------------------------------------------------

-- 종목 (등급: stable 안정주 / normal 일반주 / wild 잡주)
create table stocks (
  code text primary key,
  name text not null,
  tier text not null check (tier in ('stable', 'normal', 'wild')),
  description text not null default '',
  listed boolean not null default true
);

-- 사전 생성 틱 경로 (개장일마다 종목당 84틱, 15:00~22:00 5분 간격)
create table daily_ticks (
  stock_code text not null references stocks (code),
  date date not null,
  tick_index smallint not null check (tick_index between 0 and 83),
  price bigint not null check (price > 0),
  is_halted boolean not null default false, -- VI 거래정지 구간
  primary key (stock_code, date, tick_index)
);

-- 장중 전 종목 현재가 일괄 조회용 (date + tick_index로 8종목 lookup)
create index daily_ticks_date_tick_idx on daily_ticks (date, tick_index);

-- 일별 요약 (배치가 마감 시 기록, bias = 익일 편향 추첨 결과 %p: -30~+30, 0=중립)
create table daily_summary (
  stock_code text not null references stocks (code),
  date date not null,
  open bigint not null,
  high bigint not null,
  low bigint not null,
  close bigint not null,
  bias smallint not null default 0 check (bias between -30 and 30),
  primary key (stock_code, date)
);

create index daily_summary_date_idx on daily_summary (date);

-- ---------------------------------------------------------------------------
-- 보유·거래
-- ---------------------------------------------------------------------------

create table holdings (
  user_id bigint not null references users (id),
  stock_code text not null references stocks (code),
  quantity bigint not null check (quantity >= 0),
  avg_price bigint not null check (avg_price >= 0),
  primary key (user_id, stock_code)
);

create index holdings_stock_code_idx on holdings (stock_code);

create table trades (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id),
  stock_code text not null references stocks (code),
  side text not null check (side in ('buy', 'sell')),
  quantity bigint not null check (quantity > 0),
  price bigint not null check (price > 0), -- 체결 단가 (서버 틱 값)
  fee bigint not null default 0 check (fee >= 0), -- 매도 수수료 0.3%
  created_at timestamptz not null default now()
);

-- 거래내역 페이지: 유저별 최신순 페이지네이션
create index trades_user_created_idx on trades (user_id, created_at desc);
create index trades_stock_code_idx on trades (stock_code);

-- ---------------------------------------------------------------------------
-- 뉴스·설정
-- ---------------------------------------------------------------------------

-- 뉴스 (grade: disclosure 공시 100% / news 정식 뉴스 90% / rumor 찌라시 55%)
create table news (
  id bigint generated always as identity primary key,
  date date not null, -- 게임 날짜 (해당 뉴스가 노출되는 날)
  stock_code text references stocks (code), -- null = 시장 전체 공지
  grade text not null check (grade in ('disclosure', 'news', 'rumor')),
  title text not null,
  body text not null,
  published_at timestamptz not null default now()
);

create index news_date_idx on news (date desc, published_at desc);
create index news_stock_idx on news (stock_code, date desc);

-- 게임 설정 (이벤트 기간, 수수료율, 휴장 예외일 등)
create table config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS — 전면 차단
-- ---------------------------------------------------------------------------
-- 클라이언트(anon/authenticated)는 어떤 테이블에도 접근 불가.
-- 모든 접근은 Next.js 서버의 service role 클라이언트 경유 (RLS 우회).

alter table users enable row level security;
alter table users force row level security;
alter table signup_codes enable row level security;
alter table signup_codes force row level security;
alter table visit_codes enable row level security;
alter table visit_codes force row level security;
alter table visit_claims enable row level security;
alter table visit_claims force row level security;
alter table stocks enable row level security;
alter table stocks force row level security;
alter table daily_ticks enable row level security;
alter table daily_ticks force row level security;
alter table daily_summary enable row level security;
alter table daily_summary force row level security;
alter table holdings enable row level security;
alter table holdings force row level security;
alter table trades enable row level security;
alter table trades force row level security;
alter table news enable row level security;
alter table news force row level security;
alter table config enable row level security;
alter table config force row level security;

-- 기본 권한도 회수 (정책 없는 RLS + 무권한 이중 방어)
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- 서버(service role) 권한은 명시적으로 부여 — 환경별 기본 권한 차이에 의존하지 않는다.
-- service_role은 bypassrls 속성을 가지므로 위 RLS 차단과 무관하게 접근 가능하다.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

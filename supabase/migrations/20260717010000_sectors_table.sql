-- 섹터를 데이터로 승격 (섹터 개편 Plan 1)
-- 기존: sector가 CHECK 제약(9개) + TS유니온 + 라벨맵 하드코딩.
-- 이후: sectors 테이블 + FK. 어드민이 섹터를 데이터로 관리한다.

create table if not exists sectors (
  code       text primary key,
  label_ko   text not null,
  sort_order int  not null default 100,
  created_at timestamptz not null default now()
);

-- 기존 9 + 신규 9 = 18. 신규 섹터는 아직 참조 종목이 없어도 무방(Plan 2에서 종목 배치).
insert into sectors (code, label_ko, sort_order) values
  ('semiconductor', '반도체',        10),
  ('electronics',   '전기전자',      20),
  ('it',            'IT·플랫폼',     30),
  ('retail',        '유통·소비재',   40),
  ('auto',          '자동차',        50),
  ('media',         '미디어·엔터',   60),
  ('finance',       '금융',          70),
  ('defense',       '방산·중공업',   80),
  ('bio',           '바이오·제약',   90),
  ('energy',        '에너지·원자력', 100),
  ('materials',     '철강·소재·화학',110),
  ('food',          '식음료',        120),
  ('cosmetics',     '화장품·뷰티',   130),
  ('telecom',       '통신',          140),
  ('construction',  '건설·부동산',   150),
  ('robotics',      '로봇',          160),
  ('game',          '게임',          170),
  ('shipaero',      '조선·우주항공', 180)
on conflict (code) do nothing;

-- CHECK 제약 제거 → FK로 교체. 기존 stocks.sector 9개 값은 위 seed에 모두 존재.
alter table stocks drop constraint if exists stocks_sector_check;
alter table stocks
  add constraint stocks_sector_fkey
  foreign key (sector) references sectors(code);

-- 참조용 공개 읽기(라벨·필터). 쓰기는 service-role(RLS 우회)만.
alter table sectors enable row level security;
create policy sectors_read on sectors for select using (true);

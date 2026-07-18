-- 주간 시그니처 배지 (Weekly Signature Badges)
-- 매주 리셋되는 경쟁형 리더보드 배지 12종. 현금가치 0(순위·잔고 영향 없음).
-- 스펙: docs/superpowers/specs/2026-07-18-weekly-badges-design.md

-- ── 1) 카탈로그 ─────────────────────────────────────────────────────────────
create table weekly_badges (
  id text primary key,
  name text not null,
  description text not null,
  tie_break_note text not null default '',
  concept text not null default '',
  category text not null
    check (category in ('asset', 'story', 'activity', 'character')),
  icon_symbol text not null default '',
  is_unique boolean not null default true,  -- false면 동점 전원(VIP)
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table weekly_badges enable row level security;
alter table weekly_badges force row level security;

-- ── 2) 주차별 수여 기록 ─────────────────────────────────────────────────────
create table weekly_badge_awards (
  week_start date not null,               -- 그 주 첫 개장일(월요일 또는 이벤트 시작일)
  badge_id text not null references weekly_badges (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  metric_value numeric,                    -- 판정 근거값(표시·감사용)
  awarded_at timestamptz not null default now(),
  primary key (week_start, badge_id, user_id)  -- 유니크 배지=1행, VIP=N행
);

create index weekly_badge_awards_user_idx on weekly_badge_awards (user_id);
create index weekly_badge_awards_week_idx on weekly_badge_awards (week_start);

alter table weekly_badge_awards enable row level security;
alter table weekly_badge_awards force row level security;

-- ── 3) 캐릭터 계열 매핑 ─────────────────────────────────────────────────────
alter table stocks add column owner_character text
  check (owner_character in ('okja', 'miho', 'bana', 'mel'));  -- null = 무소속(나라카 그룹)

update stocks set owner_character = 'okja' where code in
  ('OKHX','OKSL','OKCT','OKFX','OKCC','OKSC','OKTL','OKBX','SPCO');
update stocks set owner_character = 'miho' where code in
  ('MHEN','MHBT','MIPA','NOMH','MHOL','MHRN','MHTR','MRCL','MAPL');
update stocks set owner_character = 'bana' where code in
  ('ALBN','BNZN','BNOC','BNSK','BBNN','BNAS','BNMR','BNEN');
update stocks set owner_character = 'mel' where code in
  ('MLVD','MLMT','MLTA','MELL','MLAB','MLTV','RTMC','MRSF','MRFI');

-- ── 4) 일별 총자산 스냅샷 ───────────────────────────────────────────────────
create table user_asset_snapshots (
  user_id bigint not null references users (id) on delete cascade,
  date date not null,
  total_asset bigint not null,             -- cash + Σ(보유수량 × 당일 종가)
  primary key (user_id, date)
);

create index user_asset_snapshots_date_idx on user_asset_snapshots (date);

alter table user_asset_snapshots enable row level security;
alter table user_asset_snapshots force row level security;

-- ── 5) 대표 배지 컬럼 ───────────────────────────────────────────────────────
alter table users add column representative_badge_id text
  references weekly_badges (id) on delete set null;

-- ── 6) seed: 배지 12종 ──────────────────────────────────────────────────────
insert into weekly_badges (id, name, description, tie_break_note, concept, category, icon_symbol, is_unique, sort_order) values
  ('wk-god-of-stock',    '주식의 신',    '일요일 마감 보유 자산 총액 1위',      '주간 매매 횟수↑ → 계정 오래된 유저', '시장의 절대 권력자이자 최고 자산가.',       'asset',     '1', true, 10),
  ('wk-stock-child',     '주린이',       '일요일 마감 보유 자산 총액 꼴등',      '주간 매매 횟수↑ → 계정 오래된 유저', '매운맛 파도를 맞았지만 다시 일어설 새싹.',   'asset',     'v', true, 20),
  ('wk-dopamine-emperor','도파민 황제',  '주간 단일 종목 최고 수익률(%) 기록',   '해당 종목 평가액↑ → 최종 자산↑',     '최고점 꼭대기에 깃발을 꽂은 수익률의 제왕.', 'asset',     'A', true, 30),
  ('wk-penthouse-lord',  '펜트하우스 영주','주간 단일 종목 최저 수익률(%) 기록',  '해당 종목 평가액↑ → 최종 자산↑',     '일봉 꼭대기에 강제 장기 투옥된 뚝심 주주.',  'asset',     'V', true, 40),
  ('wk-donation-angel',  '기부천사',     '주간 최고 자산 대비 마감 낙폭 최대',    '최고 자산 먼저 달성(선착) → 최종 자산↑', '천국을 맛보고 자산을 널리 베푼 롤러코스터.', 'story',     'v', true, 50),
  ('wk-money-copier',    '돈복사기',     '주간 최저 자산 대비 마감 상승폭 최대',  '최저 자산 먼저 달성(선착) → 최종 자산↑', '지하실을 뚫고 기적적으로 부활한 인간 승리.', 'story',     'A', true, 60),
  ('wk-human-macro',     '인간 매크로',  '주간 누적 매매(체결) 횟수 1위',        '총 매매 대금↑ → 최종 자산↑',        '손가락이 뇌보다 먼저 움직인 단타 광인.',     'story',     'M', true, 70),
  ('wk-vip-member',      'VIP',         '주간 출석+매장 방문 인증 합계 1위',     '동점자 전원 중복 수여',              '매장 문지방이 닳도록 드나든 최고 단골.',     'activity',  'P', false, 80),
  ('wk-major-okja',      '옥자 최대주주','일요일 마감 옥자 계열 평가 자산 1위',   '계열 비중%↑ → 계열 매매 횟수↑',      '옥자 주가를 지탱하는 핵심 큰손.',           'character', 'O', true, 90),
  ('wk-major-miho',      '미호 최대주주','일요일 마감 미호 계열 평가 자산 1위',   '계열 비중%↑ → 계열 매매 횟수↑',      '미호로 포트폴리오를 가득 채운 진성 주주.',   'character', 'H', true, 100),
  ('wk-major-bana',      '바나 최대주주','일요일 마감 바나 계열 평가 자산 1위',   '계열 비중%↑ → 계열 매매 횟수↑',      '바나를 대량 매집해 가치를 증명하는 주주.',   'character', 'B', true, 110),
  ('wk-major-mel',       '멜 최대주주',  '일요일 마감 멜 계열 평가 자산 1위',     '계열 비중%↑ → 계열 매매 횟수↑',      '멜 거래 화력을 책임진 일등공신.',           'character', 'L', true, 120)
on conflict (id) do nothing;

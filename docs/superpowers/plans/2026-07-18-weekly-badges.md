# 주간 시그니처 배지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매주 리셋되는 경쟁형 리더보드 배지 12종을 폐장 배치에서 정산·부여하고 프로필·랭킹·댓글에 노출한다.

**Architecture:** 정산은 전부 서버(Postgres 함수)에서. 매일 폐장 배치가 유저 총자산을 `user_asset_snapshots`에 기록하고, 그 주 마지막 개장일이면 `settle_weekly_badges()`가 12종 승자를 `weekly_badge_awards`에 삽입한다. 프론트는 읽기만 하며 대표 배지는 PostgREST 임베드 없이 별도 배치 조회로 합성한다.

**Tech Stack:** Next.js 16 (App Router) + React 19, TypeScript strict, Supabase(Postgres + RLS), TanStack Query v5, TailwindCSS v4 + shadcn/ui.

**스펙:** `docs/superpowers/specs/2026-07-18-weekly-badges-design.md`

## Global Constraints

- **현금가치 0**: 배지는 `users.cash`·`holdings`·랭킹 계산에 어떤 입력도 주지 않는다. `npm run simulate` 재검증 불필요.
- **모든 돈/자산 계산은 서버(Postgres)에서**. 클라이언트가 보내는 값 불신. 정산 판정은 SQL 함수 내부에서만.
- **자산은 정수(원)** — 부동소수점 금지. 수익률 계산만 `numeric` 사용(부여 판정용, 금액 아님).
- **UI 유니코드 이모지 금지** — 배지 아이콘은 `icon_symbol`(텍스트/심볼) 또는 일러스트 자산. lucide-react는 장식용만.
- **캐논 어휘 금지** — 저승·천계·명계·도깨비·염라 등 확장 파생어 금지(배지 이름·문구).
- **TypeScript strict, any 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트**. 개별 임포트(lucide-react 포함). 경로 alias `@/*`.
- **RLS 규약**: 모든 신규 테이블 `enable + force` → service role만 접근.
- **테스트 방식(프로젝트 실제)**: 단위 테스트 프레임워크 없음. 검증 = `npm run build` + `npx eslint src`(워크트리 스코프) + `npx supabase db reset` 후 로컬 psql SQL 단언 + verify 스킬(agent-browser). 로컬 DB URL은 `npx supabase status`로 확인(대개 `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
- **커밋 형식**: `type: 한국어 설명`. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **워크트리 주의**([[worktree-build-env-gotchas]]): 시작 전 `npm install` 확인. lint는 `npx eslint src`.

---

### Task 1: 마이그레이션 — 스키마·매핑·seed

**Files:**
- Create: `supabase/migrations/20260718090000_weekly_badges.sql`

**Interfaces:**
- Produces: 테이블 `weekly_badges(id,name,description,tie_break_note,concept,category,icon_symbol,is_unique,sort_order,is_active,created_at)`, `weekly_badge_awards(week_start,badge_id,user_id,metric_value,awarded_at)`, `user_asset_snapshots(user_id,date,total_asset)`; 컬럼 `stocks.owner_character`, `users.representative_badge_id`; 12종 배지 seed + 42종 owner 매핑.

- [ ] **Step 1: 마이그레이션 파일 작성 (스키마 + 매핑 + seed)**

`supabase/migrations/20260718090000_weekly_badges.sql`:

```sql
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
```

- [ ] **Step 2: db reset로 마이그레이션 적용**

Run: `npx supabase db reset`
Expected: 에러 없이 완료(모든 마이그레이션 + seed 적용).

- [ ] **Step 3: 스키마·매핑·seed 검증 (SQL 단언)**

Run (로컬 DB URL은 `npx supabase status`로 확인):
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
select (select count(*) from weekly_badges) as badges,
       (select count(*) from stocks where owner_character is not null) as mapped,
       (select count(*) from stocks where owner_character is null) as unmapped;"
```
Expected: `badges=12`, `mapped=35`, `unmapped=7` (나라카 NRK* 7종만 무소속).

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260718090000_weekly_badges.sql
git commit -m "feat: 주간 배지 스키마·캐릭터 매핑·seed 마이그레이션

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 마이그레이션 — 스냅샷·정산 함수 + reset 갱신

**Files:**
- Create: `supabase/migrations/20260718090100_weekly_badges_functions.sql`

**Interfaces:**
- Consumes: Task 1의 테이블들, 기존 `daily_summary(stock_code,date,close)`, `holdings(user_id,stock_code,quantity,avg_price)`, `trades(user_id,stock_code,side,quantity,price,created_at)`, `attendance_claims(user_id,date)`, `visit_claims(user_id,date)`, `users(id,cash,is_admin,is_banned,created_at)`, `stocks.owner_character`.
- Produces: `snapshot_user_assets(p_date date) returns int`, `settle_weekly_badges(p_week_start date, p_week_end date) returns int`. `reset_rehearsal_data`에 신규 테이블 delete 추가.

- [ ] **Step 1: 스냅샷 함수 작성**

`supabase/migrations/20260718090100_weekly_badges_functions.sql` (첫 블록):

```sql
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
```

- [ ] **Step 2: 정산 함수 작성 (같은 파일에 이어서)**

```sql
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
```

- [ ] **Step 3: reset_rehearsal_data 갱신 (같은 파일에 이어서)**

> 최신 정의는 `20260718060000_attendance_streak.sql`. 그 본문을 베이스로 신규 두 delete만 추가해 **전체 재정의**한다([[sector-overhaul-deploy-lessons]] — 이전 delete 전부 포함). 아래는 신규 두 줄을 포함한 delete 블록 추가 지침이며, 실제로는 최신 함수 본문 전체를 복사해 `delete from holdings where true;` 다음에 두 줄을 삽입한다.

```sql
-- reset_rehearsal_data: 최신 정의(20260718060000)를 베이스로 주간배지 2개 delete 추가.
-- ⚠️ 아래는 추가할 두 줄. 실제 마이그레이션엔 최신 함수 본문 전체를 복붙하고 이 두 줄을 넣을 것.
--   (holdings/trades delete 인접 위치, users delete 이전)
--     delete from weekly_badge_awards where true;
--     delete from user_asset_snapshots where true;
-- users.representative_badge_id는 on delete set null이라 users 삭제 시 자동 정리.
```

실제 구현: 최신 `reset_rehearsal_data(p_baseline_date date)` 함수 본문을 그대로 옮겨오되 `delete from holdings where true;` 아래에 다음을 추가:

```sql
  delete from weekly_badge_awards where true;
  delete from user_asset_snapshots where true;
```

- [ ] **Step 4: db reset로 적용**

Run: `npx supabase db reset`
Expected: 에러 없이 완료.

- [ ] **Step 5: 정산 시나리오 검증 (SQL 단언)**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
-- 최소 시나리오: 유저 2명, 종가 1행, 보유·스냅샷 세팅 후 정산.
insert into users (nickname, password_hash, cash) values ('테스트갑','x',500000),('테스트을','x',900000);
insert into daily_summary (stock_code, date, open, high, low, close) values ('OKJA','2026-08-09',100,120,90,110)
  on conflict do nothing;
-- 갑: OKJA 5000주(평단 100), 을: 보유 없음
insert into holdings (user_id, stock_code, quantity, avg_price)
  select id, 'OKJA', 5000, 100 from users where nickname='테스트갑';
insert into user_asset_snapshots (user_id, date, total_asset)
  select id, d, v from users u,
    (values ('2026-08-03'::date, 500000),('2026-08-09'::date, 1050000)) s(d,v)
  where u.nickname='테스트갑';
select settle_weekly_badges('2026-08-03','2026-08-09');
select badge_id, user_id, metric_value from weekly_badge_awards
  where week_start='2026-08-03' order by badge_id;
SQL
```
Expected: `wk-god-of-stock`은 테스트갑(총자산 1,050,000 > 테스트을 900,000), `wk-dopamine-emperor`는 테스트갑(수익률 0.10), `wk-major-okja`는 테스트갑에게 부여. `settle_weekly_badges`가 삽입 행 수를 반환.

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/20260718090100_weekly_badges_functions.sql
git commit -m "feat: 주간 배지 스냅샷·정산 Postgres 함수 + reset 갱신

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 배치 서비스 편입 (스냅샷 + 주말 정산)

**Files:**
- Modify: `src/services/batchService.ts` (RPC 성공 직후 `if (todayOpen)` 블록, 파일 상단 import)

**Interfaces:**
- Consumes: `snapshot_user_assets(p_date)`, `settle_weekly_badges(p_week_start,p_week_end)` RPC; `isoWeekdayOfDate`, `addDays`, `isOpenDate` from `@/lib/market`.
- Produces: 배치 실행 시 개장일마다 스냅샷 upsert, 주 마지막 개장일이면 정산 실행.

- [ ] **Step 1: market 임포트에 헬퍼 추가**

`src/services/batchService.ts`의 `@/lib/market` import에 `isoWeekdayOfDate` 추가:

```typescript
import {
  addDays,
  getKstParts,
  isOpenDate,
  isoWeekdayOfDate,
  tickTimestamp,
  ticksPerDay,
  MARKET_CLOSE_HOUR,
  MARKET_OPEN_HOUR,
  type OpenDayRules,
} from "@/lib/market";
```

- [ ] **Step 2: 주 경계 헬퍼 함수 추가 (파일 하단, runDailyBatch 뒤)**

```typescript
// 그 날짜가 속한 달력 주(월~일)의 월요일 날짜
function mondayOf(dateStr: string): string {
  return addDays(dateStr, -(isoWeekdayOfDate(dateStr) - 1));
}

// today가 이 주(월~일)의 마지막 개장일인가: 오늘 이후~그 주 일요일까지 개장일이 없으면 true
function isLastOpenDayOfWeek(today: string, rules: OpenDayRules): boolean {
  const sunday = addDays(mondayOf(today), 6);
  let d = addDays(today, 1);
  while (d <= sunday) {
    if (isOpenDate(d, rules)) return false;
    d = addDays(d, 1);
  }
  return true;
}
```

- [ ] **Step 3: RPC 성공 후 스냅샷·정산 호출 추가**

`runDailyBatch`에서 `if (error) throw error;`(apply_daily_batch) 다음, `if (todayOpen) { await recordIndexCloses(today); }` 블록 안에 이어서 추가:

```typescript
  // 지수 종가 기록 (마지막 틱 기준, upsert라 재실행 안전) — 정산일에만 의미 있음
  if (todayOpen) {
    await recordIndexCloses(today);

    // 주간 배지: 매 개장일 총자산 스냅샷 → 그 주 마지막 개장일이면 정산
    await supabase.rpc("snapshot_user_assets", { p_date: today });
    if (
      today >= config.eventStart &&
      today <= config.eventEnd &&
      isLastOpenDayOfWeek(today, config.rules)
    ) {
      const monday = mondayOf(today);
      const weekStart = monday < config.eventStart ? config.eventStart : monday;
      const { error: settleError } = await supabase.rpc("settle_weekly_badges", {
        p_week_start: weekStart,
        p_week_end: today,
      });
      if (settleError) throw settleError;
    }
  }
```

- [ ] **Step 4: 빌드·lint 검증**

Run: `npm run build && npx eslint src/services/batchService.ts`
Expected: 성공(타입·린트 통과).

- [ ] **Step 5: 실배치 스모크 (로컬)**

Run (dev 서버 실행 상태에서, 일요일 날짜로 배치 수동 실행):
```bash
curl -X POST "localhost:3000/api/cron/daily-batch?date=2026-08-09" -H "Authorization: Bearer $CRON_SECRET"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select count(*) from user_asset_snapshots where date='2026-08-09'; select count(*) from weekly_badge_awards where week_start='2026-08-03';"
```
Expected: 스냅샷 행 존재, 정산 실행됨(수여 행 존재). (참가자 데이터가 있어야 의미 있음 — 리허설 데이터 기준.)

- [ ] **Step 6: 커밋**

```bash
git add src/services/batchService.ts
git commit -m "feat: 폐장 배치에 주간 배지 스냅샷·정산 편입

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: weeklyBadgeService + 타입

**Files:**
- Create: `src/services/weeklyBadgeService.ts`
- Modify: `src/types/domain.ts` (배지 DTO 타입 추가)

**Interfaces:**
- Consumes: `getSupabaseAdmin()` from `@/lib/supabase/server`.
- Produces: `WeeklyBadge`, `UserWeeklyBadge` 타입; `listBadgeCatalog()`, `getUserWeeklyBadges(userId, weekStart?)`, `getRepresentativeBadges(userIds, weekStart)`, `setRepresentativeBadge(userId, badgeId)`, `currentWeekStart(rules, eventStart)`.

- [ ] **Step 1: 타입 추가**

`src/types/domain.ts` 하단에 추가:

```typescript
export type WeeklyBadgeCategory = "asset" | "story" | "activity" | "character";

export interface WeeklyBadge {
  id: string;
  name: string;
  description: string;
  tieBreakNote: string;
  concept: string;
  category: WeeklyBadgeCategory;
  iconUrl: string; // 현재는 icon_symbol, 일러스트 도입 시 자산 URL
  isUnique: boolean;
  sortOrder: number;
}

export interface UserWeeklyBadge extends WeeklyBadge {
  weekStart: string;
  awardedAt: string;
  metricValue: number | null;
}
```

- [ ] **Step 2: 서비스 작성**

`src/services/weeklyBadgeService.ts`:

```typescript
import "server-only";
import { ApiException } from "@/lib/api/response";
import { addDays, isoWeekdayOfDate } from "@/lib/market";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { WeeklyBadge, UserWeeklyBadge } from "@/types/domain";

interface BadgeRow {
  id: string;
  name: string;
  description: string;
  tie_break_note: string;
  concept: string;
  category: WeeklyBadge["category"];
  icon_symbol: string;
  is_unique: boolean;
  sort_order: number;
}

function toBadge(row: BadgeRow): WeeklyBadge {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tieBreakNote: row.tie_break_note,
    concept: row.concept,
    category: row.category,
    iconUrl: row.icon_symbol,
    isUnique: row.is_unique,
    sortOrder: row.sort_order,
  };
}

// 이번 주 시작일(월요일, 이벤트 시작일로 clamp). 클라이언트 무관, 서버 계산.
export function currentWeekStart(today: string, eventStart: string): string {
  const monday = addDays(today, -(isoWeekdayOfDate(today) - 1));
  return monday < eventStart ? eventStart : monday;
}

export async function listBadgeCatalog(): Promise<WeeklyBadge[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("weekly_badges")
    .select("id,name,description,tie_break_note,concept,category,icon_symbol,is_unique,sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return (data as BadgeRow[]).map(toBadge);
}

export async function getUserWeeklyBadges(
  userId: number,
  weekStart?: string,
): Promise<UserWeeklyBadge[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("weekly_badge_awards")
    .select(
      "week_start,awarded_at,metric_value,weekly_badges!inner(id,name,description,tie_break_note,concept,category,icon_symbol,is_unique,sort_order)",
    )
    .eq("user_id", userId);
  if (weekStart) query = query.eq("week_start", weekStart);
  const { data, error } = await query.order("week_start", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const badge = toBadge(
      (row as unknown as { weekly_badges: BadgeRow }).weekly_badges,
    );
    const r = row as unknown as {
      week_start: string;
      awarded_at: string;
      metric_value: number | null;
    };
    return { ...badge, weekStart: r.week_start, awardedAt: r.awarded_at, metricValue: r.metric_value };
  });
}

// 랭킹·댓글 목록의 작성자별 이번 주 대표 배지 1개 배치 조회 (N+1 방지).
// PostgREST 임베드 금지: user_id 집합으로 별도 조회 후 앱에서 합성.
export async function getRepresentativeBadges(
  userIds: number[],
  weekStart: string,
): Promise<Map<number, WeeklyBadge | null>> {
  const result = new Map<number, WeeklyBadge | null>();
  if (userIds.length === 0) return result;
  const supabase = getSupabaseAdmin();

  const [{ data: awards, error: aErr }, catalog, { data: users, error: uErr }] =
    await Promise.all([
      supabase
        .from("weekly_badge_awards")
        .select("user_id,badge_id")
        .eq("week_start", weekStart)
        .in("user_id", userIds),
      listBadgeCatalog(),
      supabase.from("users").select("id,representative_badge_id").in("id", userIds),
    ]);
  if (aErr) throw aErr;
  if (uErr) throw uErr;

  const byId = new Map(catalog.map((b) => [b.id, b]));
  // 유저별 보유 배지 집합 + sort_order 최상위 fallback
  const held = new Map<number, string[]>();
  for (const a of awards ?? []) {
    const arr = held.get(a.user_id) ?? [];
    arr.push(a.badge_id);
    held.set(a.user_id, arr);
  }
  const repChoice = new Map(
    (users ?? []).map((u) => [u.id as number, u.representative_badge_id as string | null]),
  );

  for (const uid of userIds) {
    const owned = held.get(uid) ?? [];
    if (owned.length === 0) {
      result.set(uid, null);
      continue;
    }
    const chosen = repChoice.get(uid);
    if (chosen && owned.includes(chosen)) {
      result.set(uid, byId.get(chosen) ?? null);
      continue;
    }
    // fallback: 보유 배지 중 sort_order 최상위
    const best = owned
      .map((id) => byId.get(id))
      .filter((b): b is WeeklyBadge => Boolean(b))
      .sort((a, b) => a.sortOrder - b.sortOrder)[0];
    result.set(uid, best ?? null);
  }
  return result;
}

// 대표 배지 설정: 본인이 이번 주 보유한 배지만 허용.
export async function setRepresentativeBadge(
  userId: number,
  badgeId: string | null,
  weekStart: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (badgeId !== null) {
    const { data, error } = await supabase
      .from("weekly_badge_awards")
      .select("badge_id")
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .eq("badge_id", badgeId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiException("VALIDATION", "이번 주에 보유하지 않은 배지입니다.");
  }
  const { error: updErr } = await supabase
    .from("users")
    .update({ representative_badge_id: badgeId })
    .eq("id", userId);
  if (updErr) throw updErr;
}
```

- [ ] **Step 3: 빌드 검증**

Run: `npm run build`
Expected: 성공. (타입 오류 없으면 서비스·타입 정합.)

- [ ] **Step 4: 커밋**

```bash
git add src/services/weeklyBadgeService.ts src/types/domain.ts
git commit -m "feat: weeklyBadgeService·배지 DTO 타입 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: API 라우트 3종

**Files:**
- Create: `src/app/api/weekly-badges/route.ts` (카탈로그)
- Create: `src/app/api/weekly-badges/me/route.ts` (내 이번 주 배지)
- Create: `src/app/api/weekly-badges/representative/route.ts` (대표 배지 설정)

**Interfaces:**
- Consumes: `listBadgeCatalog`, `getUserWeeklyBadges`, `setRepresentativeBadge`, `resolveCurrentWeekStart` from `@/services/weeklyBadgeService`; `apiOk`, `handleApiError` from `@/lib/api/response`; `requireUser` from `@/lib/auth/guards`.
- Produces: `GET /api/weekly-badges`, `GET /api/weekly-badges/me`, `PATCH /api/weekly-badges/representative`.

> `currentWeekStart`는 `today`·`eventStart`가 필요하다. 배치가 아닌 요청 경로에서 "오늘"은 KST 기준 날짜(`getKstParts().date`), `eventStart`는 config에서 읽는다. 아래 라우트는 config에서 event_start를 조회하는 작은 헬퍼를 서비스에 두고 재사용한다.

- [ ] **Step 1: 서비스에 이번 주 계산 헬퍼 추가**

`src/services/weeklyBadgeService.ts`에 추가(파일 상단 import에 `getKstParts` 추가):

```typescript
// 서버 기준 이번 주 시작일: KST 오늘 + config.event_start로 clamp.
export async function resolveCurrentWeekStart(): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("config")
    .select("value")
    .eq("key", "event_start")
    .maybeSingle();
  if (error) throw error;
  const eventStart = (data?.value as string) ?? "2026-08-01";
  const today = getKstParts().date;
  return currentWeekStart(today, eventStart);
}
```
(파일 상단: `import { addDays, getKstParts, isoWeekdayOfDate } from "@/lib/market";`)

- [ ] **Step 2: 카탈로그 라우트**

`src/app/api/weekly-badges/route.ts`:

```typescript
import { apiOk, handleApiError } from "@/lib/api/response";
import { listBadgeCatalog } from "@/services/weeklyBadgeService";

// 활성 배지 카탈로그 12종 (React Query 길게 캐시)
export async function GET() {
  try {
    return apiOk({ badges: await listBadgeCatalog() });
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 3: 내 배지 라우트**

`src/app/api/weekly-badges/me/route.ts`:

```typescript
import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { getUserWeeklyBadges, resolveCurrentWeekStart } from "@/services/weeklyBadgeService";

// 본인 이번 주 보유 배지 + 이번 주 시작일
export async function GET() {
  try {
    const user = await requireUser();
    const weekStart = await resolveCurrentWeekStart();
    const badges = await getUserWeeklyBadges(user.id, weekStart);
    return apiOk({ weekStart, badges });
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 4: 대표 배지 설정 라우트**

`src/app/api/weekly-badges/representative/route.ts`:

```typescript
import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { resolveCurrentWeekStart, setRepresentativeBadge } from "@/services/weeklyBadgeService";

// 대표 배지 설정 (본인 이번 주 보유분만). badgeId=null이면 해제.
// 미보유 배지면 서비스가 ApiException("VALIDATION")을 던지고 handleApiError가 400으로 변환.
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { badgeId?: string | null };
    const badgeId = body.badgeId ?? null;
    const weekStart = await resolveCurrentWeekStart();
    await setRepresentativeBadge(user.id, badgeId, weekStart);
    return apiOk({ representativeBadgeId: badgeId });
  } catch (error) {
    return handleApiError(error);
  }
}
```

> 에러 응답은 서비스의 `ApiException` + 라우트의 `handleApiError` 조합으로 처리(이 코드베이스의 표준 패턴). `apiError`는 `(code, message)` 2인자이며 상태코드는 `STATUS_BY_CODE`에서 파생된다 — 라우트에서 직접 호출하지 않는다.

- [ ] **Step 5: 빌드·lint 검증**

Run: `npm run build && npx eslint src/app/api/weekly-badges`
Expected: 성공.

- [ ] **Step 6: 라우트 스모크 (dev 서버)**

Run:
```bash
curl -s localhost:3000/api/weekly-badges | head -c 400
```
Expected: `{"success":true,"data":{"badges":[... 12종 ...]}}` 형태.

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/weekly-badges src/services/weeklyBadgeService.ts
git commit -m "feat: 주간 배지 API 라우트 3종(카탈로그·내배지·대표설정)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 카탈로그 훅 + 프로필 배지 그리드

**Files:**
- Create: `src/hooks/useWeeklyBadges.ts`
- Create: `src/components/badges/BadgeGrid.tsx`
- Modify: `src/app/portfolio/page.tsx` (그리드 섹션 삽입)

**Interfaces:**
- Consumes: `getJson` from `@/lib/api/client`; `WeeklyBadge`, `UserWeeklyBadge` 타입; `GET /api/weekly-badges`, `GET /api/weekly-badges/me`.
- Produces: `useWeeklyBadgeCatalog()`, `useMyWeeklyBadges()`; `<BadgeGrid />`.

- [ ] **Step 1: 훅 작성**

`src/hooks/useWeeklyBadges.ts`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api/client";
import type { UserWeeklyBadge, WeeklyBadge } from "@/types/domain";

// 배지 카탈로그 12종 (거의 불변 → 길게 캐시)
export function useWeeklyBadgeCatalog() {
  const { data } = useQuery({
    queryKey: ["weekly-badges"],
    queryFn: () => getJson<{ badges: WeeklyBadge[] }>("/api/weekly-badges"),
    staleTime: 1000 * 60 * 60,
  });
  return data?.badges ?? [];
}

// 본인 이번 주 보유 배지 (비로그인이면 빈 배열)
export function useMyWeeklyBadges() {
  const { data, isError } = useQuery({
    queryKey: ["weekly-badges", "me"],
    queryFn: () =>
      getJson<{ weekStart: string; badges: UserWeeklyBadge[] }>("/api/weekly-badges/me"),
    retry: false,
  });
  return {
    weekStart: data?.weekStart ?? null,
    owned: new Set((data?.badges ?? []).map((b) => b.id)),
    badges: data?.badges ?? [],
    loggedOut: isError,
  };
}
```

- [ ] **Step 2: BadgeGrid 컴포넌트 작성**

`src/components/badges/BadgeGrid.tsx`:

```tsx
"use client";

import { useMyWeeklyBadges, useWeeklyBadgeCatalog } from "@/hooks/useWeeklyBadges";

// 12종 그리드: 이번 주 보유는 강조, 미보유는 회색 잠금 + 조건 툴팁.
export function BadgeGrid() {
  const catalog = useWeeklyBadgeCatalog();
  const { owned } = useMyWeeklyBadges();

  if (catalog.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">주간 시그니처 배지</h2>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {catalog.map((badge) => {
          const has = owned.has(badge.id);
          return (
            <div
              key={badge.id}
              title={`${badge.description}${badge.tieBreakNote ? ` · ${badge.tieBreakNote}` : ""}`}
              className={
                "flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition " +
                (has
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-muted/30 opacity-50 grayscale")
              }
            >
              <span
                aria-hidden
                className={
                  "flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold " +
                  (has ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
                }
              >
                {badge.iconUrl || badge.name.slice(0, 1)}
              </span>
              <span className="text-xs font-medium leading-tight">{badge.name}</span>
              {!has && <span className="text-[10px] text-muted-foreground">미획득</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: 프로필(포트폴리오) 페이지에 삽입**

`src/app/portfolio/page.tsx`를 열어 보유 현황 섹션 아래 적절한 위치에 삽입:
- 파일 상단 import 추가: `import { BadgeGrid } from "@/components/badges/BadgeGrid";`
- JSX 내 적절한 섹션에 `<BadgeGrid />` 배치.

(포트폴리오 페이지가 서버 컴포넌트면 `BadgeGrid`는 이미 `"use client"`라 그대로 삽입 가능.)

- [ ] **Step 4: 빌드·lint 검증**

Run: `npm run build && npx eslint src/hooks/useWeeklyBadges.ts src/components/badges`
Expected: 성공.

- [ ] **Step 5: 실앱 렌더 검증 (verify 스킬)**

verify 스킬(dev + agent-browser, [[verify-agent-browser-7-16]])로 `/portfolio` 접속 → 12종 그리드 렌더, 보유 강조 vs 미보유 회색 잠금 확인. (리허설 데이터로 일부 배지 보유 상태 만들어 대비 확인.)

- [ ] **Step 6: 커밋**

```bash
git add src/hooks/useWeeklyBadges.ts src/components/badges/BadgeGrid.tsx src/app/portfolio/page.tsx
git commit -m "feat: 주간 배지 카탈로그 훅·프로필 배지 그리드(미획득 회색 잠금)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 대표 배지 칩 — 랭킹·댓글 노출

**Files:**
- Create: `src/components/badges/BadgeChip.tsx`
- Modify: `src/services/rankingService.ts` (엔트리에 대표 배지 합성)
- Modify: `src/services/commentService.ts` (작성자 대표 배지 배치 조회 합성)
- Modify: `src/components/admin/RankingSection.tsx`, `src/components/trade/StockComments.tsx` (칩 렌더)
- Modify: `src/types/domain.ts` (RankingEntry·댓글 DTO에 `representativeBadge?` 추가)

**Interfaces:**
- Consumes: `getRepresentativeBadges`, `resolveCurrentWeekStart` from `@/services/weeklyBadgeService`; `WeeklyBadge` 타입.
- Produces: `<BadgeChip badge={...} />`; 랭킹·댓글 응답에 `representativeBadge: WeeklyBadge | null`.

> **PostgREST 임베드 금지**([[postgrest-max-rows-1000-tick-pagination]]): 배지는 임베드하지 말고 작성자 `user_id` 집합으로 `getRepresentativeBadges` 별도 조회 후 앱에서 합성.

- [ ] **Step 1: BadgeChip 컴포넌트**

`src/components/badges/BadgeChip.tsx`:

```tsx
import type { WeeklyBadge } from "@/types/domain";

// 닉네임 옆 대표 배지 1개(작은 칩). 이모지 금지 — 심볼/텍스트.
export function BadgeChip({ badge }: { badge: WeeklyBadge }) {
  return (
    <span
      title={`${badge.name} · ${badge.description}`}
      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary align-middle"
    >
      <span aria-hidden className="font-bold">
        {badge.iconUrl || badge.name.slice(0, 1)}
      </span>
      {badge.name}
    </span>
  );
}
```

- [ ] **Step 2: 타입 확장**

`src/types/domain.ts`의 `RankingEntry`와 댓글 DTO에 옵셔널 필드 추가:

```typescript
// RankingEntry에 추가
  representativeBadge?: import("@/types/domain").WeeklyBadge | null;
```
(순환 import 회피: 같은 파일 내 타입이므로 `representativeBadge?: WeeklyBadge | null;`로 직접 참조. 댓글 DTO 인터페이스에도 동일 필드 추가.)

- [ ] **Step 3: rankingService에서 대표 배지 합성**

`src/services/rankingService.ts`의 `getRanking()` 반환 직전, top 엔트리에 배지 합성. `RankingEntry`에 `nickname`만 있고 `user_id`가 없으므로, 랭킹 계산 시 `user_id`를 함께 보유하도록 map을 수정한 뒤 합성:

```typescript
import { getRepresentativeBadges, resolveCurrentWeekStart } from "@/services/weeklyBadgeService";

// ... ranked 계산 시 user id를 유지 (map에서 id 포함)
// 예: .map((u) => ({ userId: u.id, nickname: u.nickname, totalAssets: ... }))
// slice(0, TOP_SIZE) 후:
const weekStart = await resolveCurrentWeekStart();
const badges = await getRepresentativeBadges(top.map((e) => e.userId), weekStart);
const topWithBadges = top.map((e) => ({
  ...e,
  representativeBadge: badges.get(e.userId) ?? null,
}));
```
(`RankingEntry`에 `userId` 노출을 원치 않으면 합성 후 제거. 최소 변경으로 top 배열에 `representativeBadge`만 추가.)

- [ ] **Step 4: commentService에서 작성자 대표 배지 합성**

`src/services/commentService.ts`의 목록 조회(`listComments`/`listAllComments`)에서, 조회된 댓글의 작성자 `user_id` 집합을 모아 배치 조회 후 각 댓글에 합성:

```typescript
import { getRepresentativeBadges, resolveCurrentWeekStart } from "@/services/weeklyBadgeService";

// 댓글 rows 조회 후:
const userIds = [...new Set(rows.map((r) => r.user_id))];
const weekStart = await resolveCurrentWeekStart();
const badgeMap = await getRepresentativeBadges(userIds, weekStart);
// 각 댓글 DTO 매핑 시: representativeBadge: badgeMap.get(row.user_id) ?? null
```

- [ ] **Step 5: 렌더 지점에 칩 삽입**

- `src/components/admin/RankingSection.tsx`: 닉네임 렌더 옆에 `{entry.representativeBadge && <BadgeChip badge={entry.representativeBadge} />}`.
- `src/components/trade/StockComments.tsx`: 작성자 닉네임 옆에 동일 패턴. (토론뷰 `DiscussionComment` 렌더도 같은 컴포넌트를 쓰면 자동 반영.)
- 각 파일 상단 `import { BadgeChip } from "@/components/badges/BadgeChip";`.

- [ ] **Step 6: 빌드·lint 검증**

Run: `npm run build && npx eslint src`
Expected: 성공.

- [ ] **Step 7: 실앱 검증 (verify 스킬)**

verify 스킬로: ①랭킹 목록 닉네임 옆 대표 배지 칩, ②댓글 작성자 옆 칩 렌더 확인. 배지 미보유 유저는 칩 없음(정상).

- [ ] **Step 8: 커밋**

```bash
git add src/components/badges/BadgeChip.tsx src/services/rankingService.ts src/services/commentService.ts src/components/admin/RankingSection.tsx src/components/trade/StockComments.tsx src/types/domain.ts
git commit -m "feat: 랭킹·댓글 작성자 대표 배지 칩 노출(임베드 없이 배치 합성)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 대표 배지 선택 UI (프로필)

**Files:**
- Modify: `src/components/badges/BadgeGrid.tsx` (보유 배지 클릭 시 대표 설정)
- Create: `src/hooks/useRepresentativeBadge.ts` (mutation)

**Interfaces:**
- Consumes: `patchJson` from `@/lib/api/client`; `PATCH /api/weekly-badges/representative`.
- Produces: `useSetRepresentativeBadge()`; BadgeGrid에서 보유 배지 선택 UX.

> `@/lib/api/client`에 `patchJson<T>(url, body)`가 **이미 존재**한다(확인됨). 그대로 사용.

- [ ] **Step 1: mutation 훅**

`src/hooks/useRepresentativeBadge.ts`:

```typescript
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchJson } from "@/lib/api/client";

export function useSetRepresentativeBadge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (badgeId: string | null) =>
      patchJson<{ representativeBadgeId: string | null }>(
        "/api/weekly-badges/representative",
        { badgeId },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ranking"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-badges", "me"] });
    },
  });
}
```

- [ ] **Step 2: BadgeGrid에서 보유 배지 선택**

`BadgeGrid.tsx`에서 보유(`has`) 배지 카드를 버튼으로 만들어 클릭 시 `useSetRepresentativeBadge().mutate(badge.id)` 호출. 현재 대표 배지(내 배지 응답에서 파악 어려우면 별도 표시 생략)와 시각적 구분(테두리 강조). 미보유 카드는 클릭 불가 유지.

```tsx
// has일 때 <div>를 <button type="button" onClick={() => setRep.mutate(badge.id)} ...> 로 교체.
// setRep = useSetRepresentativeBadge();
```

- [ ] **Step 3: 빌드·lint 검증**

Run: `npm run build && npx eslint src/hooks/useRepresentativeBadge.ts src/components/badges`
Expected: 성공.

- [ ] **Step 4: 실앱 검증 (verify 스킬)**

verify 스킬로: 보유 배지 클릭 → 랭킹·댓글의 내 대표 배지가 바뀌는지 확인. 미보유 배지 클릭 불가 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/hooks/useRepresentativeBadge.ts src/components/badges/BadgeGrid.tsx
git commit -m "feat: 프로필에서 대표 배지 유저 선택 UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 배포 (구현 완료 후, 별도 진행)

스펙 §검증·배포 참조. 요약:
1. main 머지 → Vercel 배포(코드가 배치보다 먼저, [[sector-overhaul-deploy-lessons]]).
2. 마이그레이션 2종 prod push. `weekly_badges`·`stocks.owner_character` seed 반영 확인.
3. 리허설 재생성([[rehearsal-reset-before-open]]) — `reset_rehearsal_data`가 신규 테이블 정리.
4. `npm run simulate` 불필요(현금가치 0).
5. 배치 실행시간 여유 확인([[batch-pgnet-timeout-failure]]).

## 후속 (범위 밖)

- 명예의 전당/과거 주차 히스토리 UI (스냅샷은 `weekly_badge_awards`에 보존).
- 주 초 로그인 "지난주 획득" 알림.
- 배지 일러스트 자산 교체(`icon_symbol` → `icon_url`, 소비 코드 무수정).

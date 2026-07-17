# 섹터 개편 Plan 2 — 로스터·자금 마이그레이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **선행:** Plan 1(`sectors` 테이블·FK·seed 18)이 먼저 적용돼 있어야 한다(신규 종목 sector FK 전제).

**Goal:** 로스터를 27→42종으로 확장(신규 15종 insert·기존 5종 재배치)하고, 전 종목 기준가·발행주식수·시총을 신규 밴드(우량 50만~200만 / 일반 10만~100만 / 테마 1만~30만)로 재설계, 지수 divisor를 재부트스트랩한다. 초기자금 1,000만·방문보너스 100만/일로 올리고 기존 유저에 +900만을 일회성 지급한다.

**Architecture:** 3개 마이그레이션 + UI 문구. (1) 로스터: 신규 15종·기준가·시총·섹터 재배치·divisor. (2) 자금: config·컬럼 default·기존유저 top-up. (3) 안내 문구. **가격엔진·밸런스는 스케일 불변**(전부 배수/퍼센트). 파생 리허설 데이터(미래 틱·요약·지수 이력·뉴스)는 **Plan 5**에서 "리허설 데이터 초기화 + 배치"로 재생성한다 — Plan 2는 기준일(2026-07-31) 베이스라인만 손댄다.

**Tech Stack:** Supabase(Postgres) 마이그레이션 SQL / Next.js UI 문구(TSX).

## Global Constraints

- 마이그레이션 파일명 `YYYYMMDDHHMMSS_name.sql`. 다음 순번: `20260717020000`, `20260717030000`.
- 코드 주석·커밋 한국어. 커밋 형식 `type: 한국어 설명` + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **기준일 = `2026-07-31`**(이벤트 전일 종가 = 개장 첫날 틱 생성 기준, ±30% 밴드 기준가).
- **자산은 정수(원)**. `daily_summary.volume`은 NOT NULL default 0 → insert 시 생략 가능.
- **tier↔지수**: `wild`=NASDAK, 그 외=NASPI. divisor는 기준일 시총합/1000(지수 1,000pt).
- **테스트 러너 없음.** 검증 = `npx supabase db reset` + `psql`(로컬 54322) + `npm run build`.
- 신규 종목 확정 코드(기존 27종과 무충돌):

| 코드 | 종목명 | 모티브 | 섹터 | tier | 기준가 | 발행주식수 |
|---|---|---|---|---|---:|---:|
| OKSC | 옥스코 | 포스코 | materials | stable | 1,100,000 | 40,000,000 |
| MHOL | 미호오일 | 에스오일 | energy | stable | 950,000 | 38,000,000 |
| BNMR | 바나모레퍼시픽 | 아모레퍼시픽 | cosmetics | stable | 900,000 | 36,000,000 |
| RTMC | 리얼티 멜컴 | 리얼티 인컴 | construction | stable | 700,000 | 45,000,000 |
| NRKR | 나라카로보틱스 | 두산로보틱스 | robotics | stable | 600,000 | 40,000,000 |
| NRKC | 나라카화학 | LG화학 | materials | normal | 800,000 | 27,000,000 |
| NRKH | 나라카중공업 | HD현대중공업 | defense | normal | 780,000 | 26,000,000 |
| OKTL | OKT | SK텔레콤 | telecom | normal | 550,000 | 27,000,000 |
| MHRN | 미호리온 | 오리온 | food | normal | 600,000 | 22,000,000 |
| BNEN | 바나나에너빌리티 | 두산에너빌리티 | energy | normal | 450,000 | 30,000,000 |
| NRKG | 나라카건설 | 현대건설 | construction | normal | 400,000 | 23,000,000 |
| MLAB | 멜어비스 | 펄어비스 | game | normal | 300,000 | 22,000,000 |
| MHTR | 미호토로라 | 모토로라 솔루션즈 | telecom | wild | 180,000 | 18,000,000 |
| MLTV | 멜튜이티브 | 인튜이티브 서지컬 | robotics | wild | 130,000 | 23,000,000 |
| OKBX | 옥블록스 | 로블록스 | game | wild | 85,000 | 24,000,000 |

(신규 15종. 정본은 Task 1 SQL이다.)

---

## File Structure

- `supabase/migrations/20260717020000_roster_42_reprice.sql` — **생성**. 신규 15종·기준가/시총 재설계·섹터 재배치·divisor.
- `supabase/migrations/20260717030000_capital_scale.sql` — **생성**. 초기자금·보너스·기존유저 top-up.
- `src/app/guide/page.tsx:39` — **수정**. 안내 금액 문구.
- `src/app/(auth)/signup/page.tsx:56` — **수정**. 가입 완료 토스트 금액.

---

## Task 1: 로스터 마이그레이션 (신규 15종 · 재설계 기준가/시총 · 섹터 재배치 · divisor)

**Files:**
- Create: `supabase/migrations/20260717020000_roster_42_reprice.sql`

**Interfaces:**
- Consumes: Plan 1의 `sectors` 테이블(FK 대상), 기존 `stocks`/`daily_summary`/`market_indices`.
- Produces: 42종 로스터, 기준일 베이스라인(신규 기준가), 재부트스트랩된 지수 divisor.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260717020000_roster_42_reprice.sql`:

```sql
-- 로스터 확장 27→42 + 전 종목 기준가·시총 재설계 + 섹터 재배치 + 지수 재부트스트랩
-- (섹터 개편 Plan 2). 개장 전 전제 — 파생 리허설 데이터는 Plan 5에서 재생성한다.

-- 1) 신규 15종 등록 (sector FK는 Plan 1 seed에 존재)
insert into stocks (code, name, tier, sector, description, shares_outstanding) values
  ('OKSC','옥스코','stable','materials','쇠와 불의 명가. 나라카 산업의 뼈대를 대는 철강·소재 대장주.',40000000),
  ('MHOL','미호오일','stable','energy','기름 한 방울에 울고 웃는 정유 대장. 유가 소식에 출렁인다.',38000000),
  ('BNMR','바나모레퍼시픽','stable','cosmetics','피부에 진심인 화장품 명가. 유행 한 방에 매출이 널뛴다.',36000000),
  ('RTMC','리얼티 멜컴','stable','construction','매달 꼬박꼬박 배당 주는 부동산 임대 리츠의 대명사.',45000000),
  ('NRKR','나라카로보틱스','stable','robotics','협동로봇의 선두. 자동화 붐마다 급등락 단골.',40000000),
  ('NRKC','나라카화학','normal','materials','플라스틱부터 배터리 소재까지, 나라카 화학의 자존심.',27000000),
  ('NRKH','나라카중공업','normal','defense','거대 엔진과 결계 설비를 찍어내는 중공업 강자.',26000000),
  ('OKTL','OKT','normal','telecom','혼백 통신망을 깐 통신 1위. 요금제·5G 소식에 반응한다.',27000000),
  ('MHRN','미호리온','normal','food','과자 봉지 하나로 입맛을 평정한 국민 간식 회사.',22000000),
  ('BNEN','바나나에너빌리티','normal','energy','원자로와 발전 설비의 명가. 나라카에 불을 대는 에너지주.',30000000),
  ('NRKG','나라카건설','normal','construction','탑과 다리를 올리는 건설 대장. 수주 소식에 들썩인다.',23000000),
  ('MLAB','멜어비스','normal','game','대작 게임 하나에 운명을 거는 게임사. 신작 소식에 급등락.',22000000),
  ('MHTR','미호토로라','wild','telecom','무전기부터 공공안전 장비까지, 통신 장비 노포.',18000000),
  ('MLTV','멜튜이티브','wild','robotics','수술 로봇 팔의 절대강자. 정밀 의료의 미래주.',23000000),
  ('OKBX','옥블록스','wild','game','누구나 게임을 만드는 메타 놀이터. 밈 한 방에 널뛴다.',24000000);

-- 2) 신규 15종 기준일 베이스라인 (2026-07-31 = 개장 첫날 틱 기준가)
insert into daily_summary (stock_code, date, open, high, low, close, bias) values
  ('OKSC','2026-07-31',1100000,1100000,1100000,1100000,0),
  ('MHOL','2026-07-31', 950000, 950000, 950000, 950000,0),
  ('BNMR','2026-07-31', 900000, 900000, 900000, 900000,0),
  ('RTMC','2026-07-31', 700000, 700000, 700000, 700000,0),
  ('NRKR','2026-07-31', 600000, 600000, 600000, 600000,0),
  ('NRKC','2026-07-31', 800000, 800000, 800000, 800000,0),
  ('NRKH','2026-07-31', 780000, 780000, 780000, 780000,0),
  ('OKTL','2026-07-31', 550000, 550000, 550000, 550000,0),
  ('MHRN','2026-07-31', 600000, 600000, 600000, 600000,0),
  ('BNEN','2026-07-31', 450000, 450000, 450000, 450000,0),
  ('NRKG','2026-07-31', 400000, 400000, 400000, 400000,0),
  ('MLAB','2026-07-31', 300000, 300000, 300000, 300000,0),
  ('MHTR','2026-07-31', 180000, 180000, 180000, 180000,0),
  ('MLTV','2026-07-31', 130000, 130000, 130000, 130000,0),
  ('OKBX','2026-07-31',  85000,  85000,  85000,  85000,0);

-- 3) 섹터 재배치 (기존 5종 중 4종 이동, BNAS는 defense 유지)
update stocks set sector='food'     where code='OKCC';
update stocks set sector='cosmetics' where code='MHBT';
update stocks set sector='shipaero' where code in ('BNOC','SPCO');

-- 4) 기존 27종 발행주식수 재설계
update stocks s set shares_outstanding = v.shares
from (values
  ('MLVD',90000000),('NRKE',85000000),('MAPL',75000000),('ALBN',70000000),
  ('BNZN',65000000),('OKHX',60000000),('OKSL',55000000),('NOMH',45000000),
  ('MLMT',33000000),('MRSF',30000000),('OKCT',20000000),('NRKM',30000000),
  ('MRCL',25000000),('OKFX',23000000),('BNOC',25000000),('MRFI',22000000),
  ('BNSK',21000000),('MIPA',22000000),('MHEN',24000000),('MLTA',25000000),
  ('BBNN',26000000),('SPCO',26000000),('NRKB',30000000),('MHBT',30000000),
  ('MELL',32000000),('BNAS',34000000),('OKCC',36000000)
) as v(code, shares)
where s.code = v.code;

-- 5) 기존 27종 기준일 기준가 재설계 (×10 스케일, 신규 밴드)
update daily_summary ds set open=v.p, high=v.p, low=v.p, close=v.p
from (values
  ('MLVD',1950000),('NRKE',1750000),('MAPL',1850000),('ALBN',1800000),
  ('BNZN',1700000),('OKHX',1650000),('OKSL',1550000),('NOMH',1200000),
  ('MLMT',1050000),('MRSF', 980000),('OKCT', 900000),('NRKM', 850000),
  ('MRCL', 700000),('OKFX', 620000),('BNOC', 500000),('MRFI', 420000),
  ('BNSK', 380000),('MIPA', 350000),('MHEN', 240000),('MLTA', 220000),
  ('BBNN', 200000),('SPCO', 150000),('NRKB', 120000),('MHBT', 100000),
  ('MELL',  75000),('BNAS',  60000),('OKCC',  50000)
) as v(code, p)
where ds.stock_code = v.code and ds.date = '2026-07-31';

-- 6) 지수 divisor 재부트스트랩 (기준일 42종 시총으로 나스피/나스닥 = 1,000pt)
update market_indices mi set divisor = sub.divisor
from (
  select case when s.tier='wild' then 'NASDAK' else 'NASPI' end as code,
         sum(ds.close::numeric * s.shares_outstanding) / 1000 as divisor
  from stocks s
  join daily_summary ds on ds.stock_code = s.code and ds.date = '2026-07-31'
  where s.listed
  group by 1
) sub
where mi.code = sub.code;
```

- [ ] **Step 2: 로컬 DB 리셋 적용**

Run: `npx supabase db reset`
Expected: 에러 없이 완료.

- [ ] **Step 3: 로스터·밴드·지수 검증 쿼리**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"select count(*) as stocks from stocks;
 select sector, count(*) from stocks group by sector order by 2 desc;
 select tier,
   min(ds.close) lo, max(ds.close) hi
 from stocks s join daily_summary ds on ds.stock_code=s.code and ds.date='2026-07-31'
 group by tier;
 select round((sum(ds.close::numeric*s.shares_outstanding)/mi.divisor)::numeric,1) as idx, mi.code
 from stocks s
 join daily_summary ds on ds.stock_code=s.code and ds.date='2026-07-31'
 join market_indices mi on mi.code = case when s.tier='wild' then 'NASDAK' else 'NASPI' end
 where s.listed group by mi.code, mi.divisor;"
```
Expected:
- `stocks=42`
- 섹터 18개, 전 섹터 count ≥ 2 (it=6, retail=4, 나머지 2).
- tier 밴드: stable lo≥500000 hi≤2000000, normal lo≥100000 hi≤1000000, wild lo≥10000 hi≤300000.
- 두 지수 `idx ≈ 1000.0`.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260717020000_roster_42_reprice.sql
git commit -m "feat: 로스터 42종 확장·기준가/시총 재설계·섹터 재배치·지수 재부트스트랩"
```

---

## Task 2: 자금 스케일 마이그레이션

**Files:**
- Create: `supabase/migrations/20260717030000_capital_scale.sql`

**Interfaces:**
- Consumes: `users.cash`(컬럼 default), `config`(`initial_cash`/`visit_bonus` 행).
- Produces: 초기자금 10,000,000 · 방문보너스 1,000,000 · 기존 유저 +9,000,000.

> 배경: 가입 시 현금은 `users.cash` **컬럼 default**로 지급된다(`signup_user`가 cash 미지정). 방문보너스는 `claim_visit_bonus` RPC가 `config.visit_bonus`를 읽는다. `config.initial_cash`는 표시/시뮬 참조용 — 일관성 위해 함께 갱신.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/20260717030000_capital_scale.sql`:

```sql
-- 자금 스케일: 초기자금 100만→1,000만, 방문보너스 10만→100만, 기존 유저 +900만 (섹터 개편 Plan 2)

-- 1) 신규 가입 초기자금 (users.cash 컬럼 default)
alter table users alter column cash set default 10000000;

-- 2) config 값 (표시·시뮬·보너스 RPC 참조)
update config set value = '10000000' where key = 'initial_cash';
update config set value = '1000000'  where key = 'visit_bonus';

-- 3) 기존 가입자 전원 +900만 일회성 (100만 출발자를 1,000만 출발선에 맞춤)
update users set cash = cash + 9000000;
```

- [ ] **Step 2: 로컬 DB 리셋 적용**

Run: `npx supabase db reset`
Expected: 에러 없이 완료.

- [ ] **Step 3: 검증 쿼리**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"select key, value from config where key in ('initial_cash','visit_bonus');
 select column_default from information_schema.columns
   where table_name='users' and column_name='cash';"
```
Expected: `initial_cash=10000000`, `visit_bonus=1000000`, `column_default=10000000`.
(참고: seed에 유저가 없으면 +900만 update는 0행 — 정상. 실계정/리허설 계정 존재 시 반영.)

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260717030000_capital_scale.sql
git commit -m "feat: 초기자금 1000만·방문보너스 100만·기존유저 +900만 자금 스케일"
```

---

## Task 3: 안내 문구 갱신 (초기자금·보너스 금액)

**Files:**
- Modify: `src/app/guide/page.tsx:39`
- Modify: `src/app/(auth)/signup/page.tsx:56`

**Interfaces:** 없음(정적 문구).

- [ ] **Step 1: 가이드 문구 갱신**

`src/app/guide/page.tsx:39`의 body 문자열에서 금액을 교체:
- `1,000,000원` → `10,000,000원`
- `+100,000원` → `+1,000,000원`

교체 후 해당 문장:

```ts
    body: "계좌를 만들면 10,000,000원이 지급됩니다. 매장에 방문해 게시된 '오늘의 코드'를 지갑 화면에 입력하면 하루 한 번 +1,000,000원을 더 받을 수 있어요.",
```

- [ ] **Step 2: 가입 완료 토스트 갱신**

`src/app/(auth)/signup/page.tsx:56`:

```ts
      toast.success("계좌 개설 완료! 10,000,000원이 지급되었습니다");
```

- [ ] **Step 3: 빌드**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 4: 다른 하드코딩 금액 잔존 확인**

Run: `grep -rn "1,000,000원\|100,000원" src/`
Expected: 위 2곳 외 남은 게 있으면 함께 갱신(예: 랜딩·소개 페이지). 없으면 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/app/guide/page.tsx "src/app/(auth)/signup/page.tsx"
git commit -m "docs: 초기자금·방문보너스 안내 문구 10배 갱신"
```

---

## Self-Review (플랜 작성자 체크)

- **스펙 커버리지(§2.1·§2.2·§2.3·§7 divisor)**: 신규 15종 insert(Task 1-1) ✓ / 베이스라인(Task 1-2) ✓ / 재배치 4종(Task 1-3) ✓ / 기존 27종 shares(Task 1-4)·기준가(Task 1-5) ✓ / divisor(Task 1-6) ✓ / 초기자금·보너스·top-up(Task 2) ✓ / 문구(Task 3) ✓.
- **플레이스홀더 스캔**: 없음. 모든 SQL·문구 실체 포함. Global 표(신규 15종)와 Task 1 SQL 값 일치 확인.
- **타입/값 일관성**: 신규 15종 코드·tier·sector·기준가·shares가 Global 표 = Task 1 SQL 일치. 기존 27종 기준가(×10)·shares가 스펙 §2.1 = Task 1 SQL 일치. divisor 재부트스트랩은 roster_27.sql 검증된 패턴을 UPDATE로 변형(delete/FK 회피).
- **파생 데이터 주의**: 기준가·shares 변경으로 기존 리허설 미래 틱·요약·지수 이력·뉴스가 낡음 → **Plan 5**에서 "리허설 데이터 초기화 + 배치 재생성"으로 해소(어드민 `resetRehearsalData`는 유저 계정·현금 유지 → Task 2의 +900만 보존). 이 순서 의존을 Plan 5 착수 전 반드시 지킬 것.

---

## 다음 (다음 세션)

- **Plan 3 — 엔진**: `bias.ts` 참여확률 모델, `generateSectorNews` 다건·등급화, 라벨 DB 주입.
- **Plan 4 — 콘텐츠**: 신규 15종 힌트 템플릿 ~1,275개(현재 Task 1의 1줄 소개문은 유지/보강), 섹터 뉴스 템플릿.
- **Plan 5 — 밸런스·배포**: `npm run simulate`(초기자금 1000만 반영) 재검증, prod db push, 리허설 재생성, verify.

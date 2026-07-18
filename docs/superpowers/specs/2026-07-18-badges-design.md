> **⚠️ 폐기(SUPERSEDED) — 2026-07-18.** 이 영구 성취 배지 모델은 **주간 시그니처 배지 모델**로 전면 교체되었습니다. 현행 스펙: [`2026-07-18-weekly-badges-design.md`](./2026-07-18-weekly-badges-design.md). 아래 내용은 히스토리 참고용이며 구현하지 않습니다.

# 성취 배지·타이틀 기능 설계 (몰입 로드맵 §③)

**작성일:** 2026-07-18
**브랜치:** `feat/badges` (워크트리)
**상위 스펙:** `docs/superpowers/specs/2026-07-18-immersion-features-design.md` §③ 성취 배지·타이틀
**선행 완료:** 출석 스트릭(PR#42), 소셜확장 3종(PR#43 — 댓글 엄지업·토론 세그먼트·뉴스 반응)
**병렬 진행:** 스티커(`feat/stickers`, 별도 스펙) — 표면 겹침은 아래 §병렬 충돌 참조

## 목적

수익률 순위 외에 **다양한 플레이 스타일을 명예로 인정**해 하위권 이탈을 막는다. 유저의 보유·거래·출석·순간 행동을 판정해 **성취 배지**(=타이틀)를 부여하고, 프로필·랭킹·댓글 작성자 옆에 노출한다.

- 배지는 **현금가치 0** → 잔고·평가액·시뮬에 일절 영향 없음. 상품이 걸린 이벤트라 공정성상 안전(상위 §핵심 결정 2).
- 배지 이름·설명은 **UI 유니코드 이모지 금지**([[no-emoji-in-ui]])와 **캐논 어휘 금지**(저승·천계·도깨비·염라 등 확장 파생어 금지, [[naraka-lore-canon]]) 준수. 아이콘은 텍스트/일러스트(이미지 자산)로.

## 핵심 결정 (상위 §③ 기반)

1. **현금가치 0 재확인** — 배지·타이틀은 순수 명예. `users.cash`·`holdings`·랭킹 계산식에 어떤 입력도 주지 않는다. 시뮬(`npm run simulate`) 재검증 불필요.
2. **정의(카탈로그)는 코드 seed로 고정** — 배지 종류는 소수·저빈도 변경이므로 스티커(어드민 즉시 추가)와 달리 `badges` 행을 **마이그레이션/seed에 상수로** 넣는다. 배지를 어드민에서 추가·편집하게 할지는 **[[열린 결정]]**(아래 §열린 결정). 판정 로직이 코드에 박히므로 "행만 추가"로는 새 배지가 자동 부여되지 않는다 — 이 결합이 코드 seed 우선의 근거.
3. **아이콘 자산 디커플** — 실제 일러스트는 병렬 제작 중. 지금은 배지 정의에 **텍스트/심볼(placeholder)**만 두고 기능을 끝까지 완성한다. 아이콘 표현 방식은 스티커의 `image_data_uri` 패턴과 동일한 추상화(`iconUrl` 하나만 소비)로 두어, 나중에 심볼→일러스트 교체를 소비 코드 무수정으로 흡수한다.
4. **판정 = 멱등 부여** — 모든 부여는 `user_badges`에 `on conflict do nothing`. 배치·트랜잭션이 여러 번 돌아도 중복 부여·중복 연출이 없다(배치 멱등성 규약과 동일).
5. **부여 경로 2종 분리** — (a) **배치 집계형**(보유·거래·스트릭 누적 기반)은 일일 배치 안에서 전 유저 스캔, (b) **순간 포착형**(첫 매수·첫 수익 실현·상한가 매도)은 `execute_trade` 트랜잭션 내부에서 즉시 부여. 둘 다 서버 단독 판정 — 클라이언트는 배지 부여를 요청하거나 신뢰시키지 않는다.

## 데이터 모델 (마이그레이션 1종: `20260718080000_badges.sql`)

신규 테이블 `badges` (정의/카탈로그):

```sql
create table badges (
  id text primary key,            -- 슬러그 (예: 'streak-7', 'first-profit')
  name text not null,             -- 타이틀 표시명 (예: '존버의 화신')
  description text not null,       -- 획득 조건 안내 문구
  category text not null           -- 'play_style' | 'owner_fandom' | 'moment' | 'habit'
    check (category in ('play_style', 'owner_fandom', 'moment', 'habit')),
  icon_symbol text not null default '',  -- 임시 텍스트/심볼 (일러스트 미제작 디커플)
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table badges enable row level security;
alter table badges force row level security;  -- service role만 통과 (기존 테이블 규약)
```

신규 테이블 `user_badges` (획득 기록):

```sql
create table user_badges (
  user_id bigint not null references users (id) on delete cascade,
  badge_id text not null references badges (id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)   -- 유저당 배지 1회 (멱등 부여의 근거)
);

create index user_badges_user_idx on user_badges (user_id);

alter table user_badges enable row level security;
alter table user_badges force row level security;
```

- **RLS force 규약**: 기존 모든 테이블과 동일하게 `enable + force` → 서비스 롤(서버)만 접근. 클라이언트 직접 쓰기 불가.
- **on delete cascade**: 유저·배지 삭제 시 획득 기록 자동 정리 → `reset_rehearsal_data`가 `users`를 지우면 `user_badges`도 따라 사라진다(별도 정리 불필요). `badges` 정의 테이블은 seed로 유지되므로 reset 대상 아님. 단, `user_badges`를 명시적으로 비우고 싶으면 reset에 `delete from user_badges where true;` 한 줄 추가(안전빵) — 아래 §검증·배포 참조.
- **아이콘 표현**: `icon_symbol`(텍스트/심볼)로 시작. 일러스트 도입 시 `icon_data_uri`(스티커식 base64) 또는 `icon_url` 컬럼을 추가하고 서비스 DTO의 `iconUrl`만 그쪽을 보게 바꾼다 — 소비 코드(그리드·대표배지) 무수정.

### 대표 배지 저장 (선택지 — [[열린 결정]])
랭킹·댓글 옆 "대표 배지 1개"를 어떻게 정하느냐에 따라 스키마가 갈린다:
- **자동(유저 선택 없음):** 추가 컬럼 불필요. 서비스가 `user_badges`에서 규칙(최신 `earned_at` 또는 `sort_order` 우선순위)으로 1개를 계산.
- **유저 선택:** `users.representative_badge_id text null references badges(id)` 컬럼 추가 + 선택 API. 미선택 시 자동 규칙으로 fallback.
- MVP 제안은 **자동(추가 컬럼 0)**, 유저 선택은 후속. 확정은 사장님(§열린 결정).

### seed (`supabase/seed.sql` / 마이그레이션 하단)
초기 배지 세트를 `badges`에 삽입(아이콘은 `icon_symbol` 임시값). **세트 확정·문구는 [[열린 결정]]** — 아래는 후보 초안:

```sql
insert into badges (id, name, description, category, icon_symbol, sort_order) values
  ('first-buy',     '첫 거래',        '첫 매수를 체결했다.',              'moment',      '★', 10),
  ('first-profit',  '첫 수익 실현',   '처음으로 이익을 남기고 팔았다.',   'moment',      '＄', 20),
  ('upper-sell',    '천장 사냥꾼',    '상한가에서 매도에 성공했다.',      'moment',      '▲', 30),
  ('streak-7',      '개근 요괴',      '연속 출석 7일을 달성했다.',        'habit',       '7', 40),
  ('streak-14',     '개근의 달인',    '연속 출석 14일을 달성했다.',       'habit',       '14', 50),
  ('streak-30',     '개근의 화신',    '연속 출석 30일을 달성했다.',       'habit',       '30', 60),
  ('diamond-hand',  '존버의 화신',    '한 종목을 오래 들고 버텼다.',      'play_style',  '◆', 70),
  ('day-trader',    '단타 요괴',      '짧게 자주 사고팔았다.',            'play_style',  '⚡', 80),
  ('gambler',       '잡주 도박사',    '변동성 큰 종목에 집중했다.',       'play_style',  '※', 90)
on conflict (id) do nothing;
```
(이름·문구·심볼은 캐논 어휘 금지 검토를 거쳐 사장님 확정. `owner_fandom` 카테고리 배지는 계열 매핑 확정 후 추가 — §판정 참조.)

## 판정 로직

### 순간 포착형 — `execute_trade` 트랜잭션 내부 부여
매수/매도 체결 직후, 같은 트랜잭션에서 `award_badge(p_user_id, ...)`(멱등)를 호출한다. 체결과 원자 처리되므로 "체결됐는데 배지만 누락" 같은 불일치가 없다.

- **첫 거래(`first-buy`):** `p_side='buy'` 체결 성공 시. (온보딩 §④ "첫 매수 축하"와 자산 공유 — 첫 매수 트리거를 배지 부여로 통일.) 이 유저의 첫 매수인지는 방금 삽입한 `trades`에서 `count(*) where user_id and side='buy'` = 1 로 판정하거나, `user_badges`에 이미 있으면 `on conflict`로 무시되므로 무조건 호출해도 안전.
- **첫 수익 실현(`first-profit`):** `p_side='sell'` 체결 시 `v_price > v_holding.avg_price`(체결가 > 평단)면 부여. `execute_trade`는 이미 `v_holding.avg_price`를 로컬로 들고 있어 추가 조회 없이 판정 가능.
- **상한가 매도(`upper-sell`):** 매도 체결가 `v_price`가 당일 상한가(직전 개장일 종가 ×1.30, `PRICE_LIMIT_RATE`)에 도달했을 때. 정확한 "상한 도달" 판정 기준(체결가 == 상한 틱값 vs 상한 근접 허용오차)은 **[[열린 결정]]**.
- **부여 연출:** `execute_trade` 반환 jsonb에 `awardedBadges: text[]`(이번 체결로 새로 획득한 배지 id)를 추가 → 프론트가 토스트/모달로 축하 연출(온보딩 §④ "첫 매수 축하"가 이 필드를 소비).

### 배치 집계형 — 일일 배치(`apply_daily_batch` 이후 단계) 부여
폐장 배치에서 전 유저를 스캔해 누적 조건을 판정. 배치는 이미 멱등이고 하루 1회이므로 무거운 집계에 적합.

- **습관 / 출석 스트릭(`streak-7/14/30`):** `attendance_claims`의 유저별 `max(streak)`가 임계 도달 시 부여. **①과 자산 공유** — 스트릭 값은 스트릭 기능이 이미 계산·저장. (대안: `claim_attendance_bonus` 함수 안에서 스트릭 도달 즉시 부여 — 즉시성↑, 스트릭 마이그레이션과의 결합↑. 배치 집계가 기능 격리엔 유리. **[[열린 결정]]**.)
- **존버의 화신(`diamond-hand`):** 현재 보유 중인 종목을 **N일 이상 연속 보유**. `holdings`엔 보유 시작일이 없으므로, 판정은 "해당 종목 현재 보유 && 가장 최근 매수 이후 무매도로 N일 경과"를 `trades` 최신 이력으로 근사. **N일 임계값 = [[열린 결정]]**.
- **단타 요괴(`day-trader`):** 매매(체결) 횟수 누적 또는 하루 최다 N회. `trades` count 집계. **횟수 임계값·집계 창(하루/누적) = [[열린 결정]]**.
- **잡주 도박사(`gambler`):** 보유 평가액 중 `stocks.tier='wild'` 비중이 X% 이상. `holdings`×현재 틱가로 비중 계산(랭킹 평가액 계산과 동일 소스). **비중 임계값 = [[열린 결정]]**.
- **오너 팬덤(`owner_fandom`, 예 '옥자 가문의 집사'):** 특정 오너(옥자/미호/멜/바나) **계열주 집중 보유**. **현재 스키마에 오너/계열 매핑이 없다**(stocks에 tier·sector만, sectors 테이블에 owner 컬럼 없음). 계열 정의 방법(신규 매핑 테이블 vs stocks에 `owner` 컬럼 vs 코드 상수 맵)과 "집중"의 임계값이 모두 **[[열린 결정]]** → **이 카테고리는 매핑 확정 전까지 초기 세트에서 보류** 권장.
- **뉴스 사냥꾼(찌라시 적중):** 찌라시(`news.grade='rumor'`) 방향과 일치하는 매매로 이익. 뉴스-매매 인과 판정이 복잡(적중 정의·시간창) → **범위 밖/후속 권장, 도입 시 판정 규칙 = [[열린 결정]]**.

### 부여 헬퍼 (Postgres 함수)
```sql
-- 멱등 부여: 이미 있으면 무시, 신규면 삽입 후 true 반환.
create or replace function award_badge(p_user_id bigint, p_badge_id text)
returns boolean language plpgsql as $$
declare v_new boolean;
begin
  insert into user_badges (user_id, badge_id) values (p_user_id, p_badge_id)
  on conflict do nothing;
  get diagnostics v_new = row_count;  -- 1이면 신규 부여
  return v_new > 0;
end $$;
```
배치 집계형은 `apply_daily_batch` 말미(또는 배치 전용 함수 `award_batch_badges()`)에서 전 유저 대상 조건별 `award_badge` 호출. `execute_trade`는 순간 포착 조건 충족 시 인라인 호출하고 신규분을 `awardedBadges`로 수집.

## 서비스 · API 계층

### `src/services/badgeService.ts` (신규)
- `listBadgeCatalog(): Promise<Badge[]>` — 활성 배지 정의(그리드/설명용). `sort_order` 정렬.
- `getUserBadges(userId): Promise<UserBadge[]>` — 유저 획득 배지 + 정의 조인(name·description·category·iconUrl·earnedAt).
- `getRepresentativeBadges(userIds: number[]): Promise<Map<number, Badge|null>>` — 랭킹·댓글 목록에서 작성자별 대표 배지 1개 **배치 조회**(N+1 방지). 자동 규칙(최신/우선순위) 또는 `representative_badge_id` 반영.
- (유저 선택 채택 시) `setRepresentativeBadge(userId, badgeId)` — 본인 획득분만 허용 검증.

`Badge` DTO: `{ id, name, description, category, iconUrl, sortOrder }` (`iconUrl`은 지금 `icon_symbol`, 일러스트 도입 시 자산 URL). `UserBadge`: `Badge & { earnedAt }`.

### 배치 편입 지점
- `src/services/batchService.ts` — `apply_daily_batch` RPC 성공 직후 `award_batch_badges()` RPC 1회 호출(또는 `apply_daily_batch` 내부에 편입). `BatchResult`에 `badgesAwarded: number` 추가(운영 로그용). **배치 순서상 정산·틱 생성 이후**라 평가액·보유가 확정된 상태에서 집계.
- 순간 포착형은 `src/services/tradeService.ts`가 `execute_trade` 반환의 `awardedBadges`를 그대로 API 응답 DTO에 전달(체결 응답에 동봉).

### API
- `GET /api/badges` → 활성 배지 카탈로그 `{ id, name, description, category, iconUrl }[]`. `ApiResponse<T>` 래퍼. React Query 1회 캐시.
- `GET /api/users/me/badges` (또는 프로필 로더에 편입) → 본인 획득 배지 목록.
- 매수/매도 응답 DTO에 `awardedBadges: string[]` 추가(첫 매수·순간 포착 연출 트리거).
- (유저 선택 채택 시) `PATCH /api/users/me/representative-badge` — 본인 획득분만.
- 어드민 배지 관리 API는 **어드민 편집 채택 시에만**(§열린 결정) `/api/admin/badges` 추가 — 기존 `/api/admin/*` 가드·패턴 재사용.

## UI 계층

- **카탈로그 훅** `useBadges()` — `["badges"]` 쿼리로 정의 세트 1회 로드(`staleTime` 길게), id→`{name, description, iconUrl}` 맵 제공.
- **프로필/지갑 배지 그리드** (신규 컴포넌트, `src/components/` 프로필/포트폴리오 영역) — 획득 배지 카드 그리드(아이콘 심볼/일러스트 + 이름 + 설명 툴팁). 미획득 배지를 회색으로 함께 보여줄지는 소소한 UX 결정(도전 유도 vs 단순). 유니코드 이모지 아님(심볼/일러스트 자산).
- **랭킹 목록 대표 배지** (`src/components/admin/RankingSection.tsx` 등 랭킹 렌더 지점) — 닉네임 옆 대표 배지 1개. `getRepresentativeBadges` 배치 조회로 N+1 회피.
- **댓글 작성자 대표 배지** (`StockComments.tsx` + 토론뷰 `DiscussionComment` 렌더) — 닉네임 옆 대표 배지 1개. `commentService`의 `listComments`/`listAllComments`가 작성자 대표 배지를 함께 반환(현재 `users!...(nickname)` 임베드에 배지는 별도 배치 조회로 합성 — 아래 PostgREST 주의).
- **획득 축하 연출** — 매수/매도 응답 `awardedBadges`가 비어있지 않으면 sonner 토스트 또는 모달로 "새 배지 획득" 표시. 온보딩 §④ 첫 매수 축하가 이 경로를 공유.

### PostgREST 임베드 주의 ([[postgrest-max-rows-1000-tick-pagination]]·PR#43 교훈)
댓글 조회에 `badges`를 직접 임베드하면 `stock_comments → users → user_badges → badges` 다단 조인·관계 모호성(PGRST201) 위험. **대표 배지는 임베드하지 말고**, 댓글 목록에서 작성자 `user_id` 집합을 모아 `getRepresentativeBadges`로 **별도 배치 조회** 후 앱에서 합성한다(스티커가 `sticker_id`만 싣고 카탈로그를 분리한 것과 동일 원칙).

## 검증 · 배포

1. `npm run build` + `npm run lint` 통과.
2. **verify 스킬**(dev + agent-browser, [[verify-agent-browser-7-16]])로 실앱 확인:
   - 첫 매수 체결 → `first-buy` 부여 + 축하 연출.
   - 매도로 이익 실현 → `first-profit` 부여.
   - 출석 스트릭 임계(리허설로 단축) → 배치 후 `streak-*` 부여.
   - 프로필 배지 그리드 렌더, 랭킹·댓글 작성자 옆 대표 배지 렌더.
   - 배치 2회 실행에도 중복 부여·중복 연출 없음(멱등).
3. 마이그레이션 **prod push** + **리허설 재생성**([[rehearsal-reset-before-open]], [[sector-overhaul-deploy-lessons]]) — 코드 배포(main 머지→Vercel)가 배치보다 먼저. `badges` 정의는 seed/마이그레이션으로 prod에도 삽입, `user_badges`는 cascade 정리. reset 함수에 `delete from user_badges where true;` 추가(명시적 초기화, 안전빵).
4. **시뮬 영향 없음**(현금가치 0) — `npm run simulate` 재검증 불필요.
5. 배치 편입 시 실행시간 주의([[batch-pgnet-timeout-failure]]) — 전 유저 배지 집계가 무거우면 `maxDuration`/pg_net timeout 여유 확인.

## 범위 밖 (YAGNI / 후속)

- 뉴스 사냥꾼(찌라시 적중) 배지 — 인과 판정 복잡, 후속.
- 오너 팬덤 배지 — 계열 매핑 확정 전 보류.
- 배지 진행률 바("7일 중 5일"), 배지 획득 히스토리 타임라인, 배지별 랭킹 — 하지 않음.
- 유저가 만드는 커스텀 배지, 배지 거래/증정 — 하지 않음.
- 온보딩 §④ 상황별 툴팁 — 별도 스펙(첫 매수 축하 연출만 배지와 자산 공유).

## 병렬 구현 시 다른 기능과의 표면 겹침 (충돌 지점)

- **일일 배치(`batchService`·`apply_daily_batch`):** 스트릭은 이미 배치 무관(claim 함수), 배지는 **배치에 집계 단계를 새로 편입**. 다른 배치 편집(뉴스·정산)과 같은 파일·함수를 건드리므로 **머지 충돌 1순위**. → 배지 집계는 `award_batch_badges()` 별도 함수로 떼어 `apply_daily_batch` 성공 후 호출하면 배치 본문 수정 최소화.
- **`execute_trade` 함수:** 순간 포착 부여를 인라인 추가. 거래 함수는 지정가·수량매수 등으로 자주 재정의된 파일 → 최신 정의(`20260714070000_limit_orders.sql` 계보) 기준으로 신중히 편집. 스티커·소셜은 이 함수를 건드리지 않아 충돌 없음.
- **프로필/랭킹/댓글 렌더:** 랭킹·댓글 작성자 옆 **대표 배지**는 스티커(댓글 본문 스티커)와 **같은 댓글 렌더 지점**을 수정 → `StockComments.tsx`·`DiscussionComment` 렌더에서 스티커 스펙과 **동시 편집 충돌 가능**. 병렬 시 한쪽 머지 후 다른 쪽 리베이스 권장.
- **마이그레이션 번호:** 스티커와 배지가 각각 `20260718080000_*.sql`을 노리면 **파일명 충돌**. 나중에 머지되는 쪽이 다음 타임스탬프(예: `...090000`)로 리네임.
- **`reset_rehearsal_data` 재정의:** 스트릭·스티커·배지가 각자 이 함수에 `delete` 한 줄씩 추가하며 **함수 전체를 재정의** → 마이그레이션이 겹치면 **최신 정의 계보를 따라 누적 반영**해야 한다(한쪽이 다른 쪽 delete를 덮어쓰지 않도록). 머지 순서대로 이전 delete들을 모두 포함시킨다.
- **`users` 테이블 컬럼:** 대표 배지를 유저 선택으로 하면 `users.representative_badge_id` 추가 — 온보딩이 `users.onboarded_at`을 추가할 수 있어 같은 테이블 ALTER가 겹칠 수 있음(각자 다른 컬럼이라 논리 충돌은 없으나 마이그레이션 순서 유의).

## 열린 결정 (사장님 확인 필요)

- **초기 배지 세트 확정** — 위 seed 후보 9종의 채택 여부, 이름·설명 문구(캐논 어휘 금지 검토), 심볼/일러스트.
- **각 임계값** — 존버(연속 보유 며칠), 단타(매매 몇 회·하루/누적), 잡주 도박사(wild 비중 몇 %), 상한가 매도(정확 상한 vs 근접 허용오차).
- **출석 스트릭 배지 부여 위치** — 배치 집계 vs `claim_attendance_bonus` 인라인(즉시성 ↔ 기능 격리).
- **대표 배지 선택 방식** — 자동(최신/우선순위) vs 유저 선택(`representative_badge_id` 컬럼·API 추가).
- **오너 팬덤 배지** — 계열(오너별) 매핑을 어디에 둘지(신규 테이블 vs stocks 컬럼 vs 코드 상수) + "집중 보유" 임계값. 미확정 시 초기 세트에서 보류.
- **뉴스 사냥꾼(찌라시 적중) 배지** — 도입 여부 및 적중 판정 규칙(시간창·이익 기준).
- **배지 정의 어드민 관리 포함 여부** — 코드 seed 고정만으로 갈지, 어드민에서 이름·설명·심볼·활성 편집을 허용할지(판정 로직은 여전히 코드라 "새 배지 = 코드 배포"인 점 감안).
- **미획득 배지 그리드 노출 여부** — 회색 잠금 표시로 도전 유도 vs 획득분만 노출.

# 주간 시그니처 배지 기능 설계 (Weekly Signature Badges)

**작성일:** 2026-07-18
**브랜치:** `feat/badges` (워크트리)
**대체:** `docs/superpowers/specs/2026-07-18-badges-design.md` (영구 성취 배지 모델 — **폐기/superseded**)
**상위 스펙:** `docs/superpowers/specs/2026-07-18-immersion-features-design.md` §③ 성취 배지·타이틀
**선행 완료:** 출석 스트릭(PR#42), 소셜확장 3종(PR#43), 출석 접속 스트릭(`20260718060000_attendance_streak.sql`)
**병렬 진행:** 스티커(`feat/stickers`) — 댓글 렌더 표면 겹침은 §병렬 충돌 참조

## 목적

수익률 순위 외에 **다양한 플레이 스타일을 매주 명예로 인정**해 하위권 이탈을 막고 주간 리듬을 만든다. 매주 리셋되는 **경쟁형 리더보드 배지 12종**을 정산해, 주차별 승자에게 부여하고 프로필·랭킹·댓글 작성자 옆에 노출한다.

- 배지는 **현금가치 0** → 잔고·평가액·시뮬·랭킹 계산에 일절 입력을 주지 않는다. 상품이 걸린 이벤트라 공정성상 안전.
- 배지 이름·설명은 **UI 유니코드 이모지 금지**([[no-emoji-in-ui]])와 **캐논 어휘 금지**([[naraka-lore-canon]] — 저승·천계·명계·도깨비·염라 등) 준수. 아이콘은 텍스트/심볼(placeholder)로 시작, 일러스트 도입 시 소비 코드 무수정 교체.

## 핵심 결정 (확정)

1. **주간 배지로 전면 교체** — 기존 영구 성취 배지 스펙은 폐기. 유저별 멱등 부여가 아니라 **주차별 랭킹 1위 확정**(동점 판정 체이닝 → `LIMIT 1`) 모델로 간다.
2. **주차 경계 = 달력 주(월~일)** — 매주 월요일 장 오픈 시점에 전주 소유권이 리셋되고, **일요일 장 마감 데이터를 기준**으로 최종 소유자를 확정. 구현은 **일요일 폐장 배치에 정산을 편입**(별도 크론 없음, §정산 트리거 참조).
3. **소유권 = 주차별 1인 독점(`is_unique`)** — 한 주 동안 각 배지는 단 1명만 보유. **VIP(`wk-vip-member`)만 동점자 전원 중복 수여**.
4. **현금가치 0 재확인** — 배지·타이틀은 순수 명예. `npm run simulate` 재검증 불필요.
5. **아이콘 자산 디커플** — 지금은 `icon_symbol`(텍스트/심볼)만. 일러스트 도입 시 컬럼 추가 + 서비스 DTO의 `iconUrl`만 그쪽을 보게 바꿔 소비 코드(그리드·대표배지) 무수정 흡수.
6. **정산은 서버 단독** — 클라이언트는 배지 부여를 요청하거나 신뢰시키지 않는다. 모든 판정은 폐장 배치(서버) 내부에서만.

## 이벤트 기간의 주차 (8/1 토 ~ 8/30 일)

| 라운드 | 기간 | 정산일(일요일 폐장) |
|---|---|---|
| Week 0 (스텁) | 8/1(토)~8/2(일) | 8/2 |
| Week 1 | 8/3(월)~8/9(일) | 8/9 |
| Week 2 | 8/10(월)~8/16(일) | 8/16 |
| Week 3 | 8/17(월)~8/23(일) | 8/23 |
| Week 4 | 8/24(월)~8/30(일) | 8/30 |

- `week_start`는 그 주 **월요일 날짜**(스텁 주는 8/1 토를 시작으로 특수 처리하거나 8/1을 `week_start`로 저장 — 구현 시 "해당 주의 첫 개장일"로 정의).
- 정산은 그 주의 **마지막 개장일 폐장 배치**에서 실행. 휴장일 지정 시 "마지막 개장일"로 자연스럽게 밀린다([[market-hours-operating-value.md]]).

## 데이터 모델 (마이그레이션 1종: `20260718090000_weekly_badges.sql`)

> 마이그레이션 번호는 스티커와 충돌 시 다음 타임스탬프로 리네임(§병렬 충돌).

### 1) `weekly_badges` (카탈로그/정의)

```sql
create table weekly_badges (
  id text primary key,               -- 슬러그 (예: 'wk-god-of-stock')
  name text not null,                -- 표시명 (예: '주식의 신')
  description text not null,          -- 획득 조건 안내
  tie_break_note text not null default '',  -- 동점 판정 안내(툴팁용)
  concept text not null default '',   -- 인게임 뉘앙스(툴팁/상세)
  category text not null              -- 'asset' | 'story' | 'activity' | 'character'
    check (category in ('asset', 'story', 'activity', 'character')),
  icon_symbol text not null default '',  -- 임시 텍스트/심볼 (일러스트 미제작 디커플)
  is_unique boolean not null default true,  -- false면 동점 전원(VIP)
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table weekly_badges enable row level security;
alter table weekly_badges force row level security;  -- service role만 통과
```

### 2) `weekly_badge_awards` (주차별 수여 기록)

```sql
create table weekly_badge_awards (
  week_start date not null,           -- 주차 식별 (그 주 첫 개장일)
  badge_id text not null references weekly_badges (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  -- 판정 근거값 보존(표시·감사용, 배지별 의미 다름): 자산/수익률/횟수 등
  metric_value numeric,
  awarded_at timestamptz not null default now(),
  primary key (week_start, badge_id, user_id)  -- 유니크 배지=1행, VIP=N행
);

create index weekly_badge_awards_user_idx on weekly_badge_awards (user_id);
create index weekly_badge_awards_week_idx on weekly_badge_awards (week_start);

alter table weekly_badge_awards enable row level security;
alter table weekly_badge_awards force row level security;
```

- **유니크 배지 소유권**: 정산 로직이 배지당 1행만 insert하므로 스키마 unique 제약은 불필요(오히려 VIP 다중 수여와 충돌). 소유권 단일성은 정산 함수의 `LIMIT 1`로 보장.
- **멱등 정산**: 정산 함수 시작 시 `delete from weekly_badge_awards where week_start = p_week_start` 후 재삽입 → 같은 주 배치가 2번 돌아도 결과 동일(배치 멱등성 규약).
- **전주 스냅샷 보존**: `weekly_badge_awards`는 리셋하지 않고 주차별로 누적 → 명예의 전당/히스토리 소스. "소유권 리셋"은 현재 주 UI가 `week_start = 이번주`만 보여주는 것으로 구현(행 삭제 아님).

### 3) `stocks.owner_character` (캐릭터 계열 매핑)

```sql
alter table stocks add column owner_character text
  check (owner_character in ('okja', 'miho', 'bana', 'mel'));  -- null = 무소속

update stocks set owner_character = 'okja' where code in
  ('OKHX','OKSL','OKCT','OKFX','OKCC','OKSC','OKTL','OKBX','SPCO');
update stocks set owner_character = 'miho' where code in
  ('MHEN','MHBT','MIPA','NOMH','MHOL','MHRN','MHTR','MRCL','MAPL');
update stocks set owner_character = 'bana' where code in
  ('ALBN','BNZN','BNOC','BNSK','BBNN','BNAS','BNMR','BNEN');
update stocks set owner_character = 'mel' where code in
  ('MLVD','MLMT','MLTA','MELL','MLAB','MLTV','RTMC','MRSF','MRFI');
-- NRK* 나라카 그룹 7종(NRKE,NRKM,NRKB,NRKR,NRKC,NRKH,NRKG)은 owner_character = null
```

전체 42종이 빈틈없이 배정됨: 옥자 9 + 미호 9 + 바나 8 + 멜 9 + 무소속(나라카) 7 = 42.

### 4) `user_asset_snapshots` (일별 총자산 스냅샷)

```sql
create table user_asset_snapshots (
  user_id bigint not null references users (id) on delete cascade,
  date date not null,                 -- 폐장 배치 실행 대상일
  total_asset bigint not null,        -- cash + Σ(보유수량 × 당일 종가)
  primary key (user_id, date)
);

create index user_asset_snapshots_date_idx on user_asset_snapshots (date);

alter table user_asset_snapshots enable row level security;
alter table user_asset_snapshots force row level security;
```

- **채우는 시점**: 매일 폐장 배치가 정산 후(평가액 확정 상태) 전 유저 총자산 1행씩 upsert. 주중 고점/저점은 그 주 스냅샷들의 `max/min`.
- **총자산 = 정수(원)**: `cash + Σ(holdings.quantity × 당일 종가)`. 랭킹 총자산 계산과 **동일 소스·동일 공식** 재사용([[postgrest-max-rows-1000-tick-pagination]] 페이지네이션 주의는 서버 함수 내부 계산이라 무관).

### seed (마이그레이션 하단) — 배지 12종

```sql
insert into weekly_badges (id, name, description, tie_break_note, concept, category, icon_symbol, is_unique, sort_order) values
  ('wk-god-of-stock',    '주식의 신',   '일요일 마감 보유 자산 총액 1위',       '주간 매매 횟수↑ → 계정 오래된 유저', '시장의 절대 권력자이자 최고 자산가.',      'asset',     '1', true, 10),
  ('wk-stock-child',     '주린이',      '일요일 마감 보유 자산 총액 꼴등',       '주간 매매 횟수↑ → 계정 오래된 유저', '매운맛 파도를 맞았지만 다시 일어설 새싹.',  'asset',     'v', true, 20),
  ('wk-dopamine-emperor','도파민 황제', '주간 단일 종목 최고 수익률(%) 기록',    '해당 종목 평가액↑ → 최종 자산↑',     '최고점 꼭대기에 깃발을 꽂은 수익률의 제왕.', 'asset',    '＾', true, 30),
  ('wk-penthouse-lord',  '펜트하우스 영주','주간 단일 종목 최저 수익률(%) 기록',  '해당 종목 평가액↑ → 최종 자산↑',     '일봉 꼭대기에 강제 장기 투옥된 뚝심 주주.', 'asset',    'v', true, 40),
  ('wk-donation-angel',  '기부천사',    '주간 최고 자산 대비 마감 낙폭 최대',    '최고 자산 먼저 달성(선착) → 최종 자산↑', '천국을 맛보고 자산을 널리 베푼 롤러코스터.', 'story',    'v', true, 50),
  ('wk-money-copier',    '돈복사기',    '주간 최저 자산 대비 마감 상승폭 최대',  '최저 자산 먼저 달성(선착) → 최종 자산↑', '지하실을 뚫고 기적적으로 부활한 인간 승리.', 'story',    '＾', true, 60),
  ('wk-human-macro',     '인간 매크로', '주간 누적 매매(체결) 횟수 1위',        '총 매매 대금↑ → 최종 자산↑',        '손가락이 뇌보다 먼저 움직인 단타 광인.',    'story',    '≋', true, 70),
  ('wk-vip-member',      'VIP',        '주간 출석+매장 방문 인증 합계 1위',     '동점자 전원 중복 수여',              '매장 문지방이 닳도록 드나든 최고 단골.',    'activity', 'V', false, 80),
  ('wk-major-okja',      '옥자 최대주주','일요일 마감 옥자 계열 평가 자산 1위',   '계열 비중%↑ → 계열 매매 횟수↑',      '옥자 주가를 지탱하는 핵심 큰손.',          'character','O', true, 90),
  ('wk-major-miho',      '미호 최대주주','일요일 마감 미호 계열 평가 자산 1위',   '계열 비중%↑ → 계열 매매 횟수↑',      '미호로 포트폴리오를 가득 채운 진성 주주.',  'character','M', true, 100),
  ('wk-major-bana',      '바나 최대주주','일요일 마감 바나 계열 평가 자산 1위',   '계열 비중%↑ → 계열 매매 횟수↑',      '바나를 대량 매집해 가치를 증명하는 주주.',  'character','B', true, 110),
  ('wk-major-mel',       '멜 최대주주', '일요일 마감 멜 계열 평가 자산 1위',     '계열 비중%↑ → 계열 매매 횟수↑',      '멜 거래 화력을 책임진 일등공신.',          'character','L', true, 120)
on conflict (id) do nothing;
```

(이름·문구·심볼은 캐논 어휘 금지 검토를 거친 값. `icon_symbol`은 임시 placeholder — 일러스트 도입 시 교체.)

## 판정 로직 (일요일 마감 데이터 기준)

정산 함수 `settle_weekly_badges(p_week_start date, p_week_end date, p_at timestamptz)`가 그 주 데이터를 집계해 12종 승자를 산출·삽입. 각 배지는 **동점 판정 우선순위를 `ORDER BY` 체이닝 후 `LIMIT 1`**(VIP만 예외).

| 배지 | 승자 판정 (`ORDER BY … LIMIT 1`) | 데이터 소스 |
|---|---|---|
| `wk-god-of-stock` | 마감 총자산 **DESC** → 주간 매매횟수 DESC → 계정 생성 ASC | 마감 총자산, `trades`(주간), `users.created_at` |
| `wk-stock-child` | 마감 총자산 **ASC** → (동률) 주간 매매횟수 DESC → 계정 생성 ASC | 위와 동일 |
| `wk-dopamine-emperor` | 유저별 **최고** 단일종목 평가수익률 DESC → 해당종목 평가액 DESC → 마감 총자산 DESC | 마감 `holdings.avg_price` × 현재 틱가 |
| `wk-penthouse-lord` | 유저별 **최저** 단일종목 평가수익률 ASC → 해당종목 평가액 DESC → 마감 총자산 DESC | 위와 동일 |
| `wk-donation-angel` | (주간 고점−마감)/고점 **DESC** → 고점 달성일 ASC(선착) → 마감 총자산 DESC | `user_asset_snapshots`(주간 max), 마감값 |
| `wk-money-copier` | (마감−주간 저점)/저점 **DESC** → 저점 달성일 ASC(선착) → 마감 총자산 DESC | `user_asset_snapshots`(주간 min), 마감값 |
| `wk-human-macro` | 주간 매매횟수 **DESC** → 주간 총 매매대금 DESC → 마감 총자산 DESC | `trades`(주간) count·sum |
| `wk-vip-member` | 출석+방문 합계 = `MAX`인 **전원**(LIMIT 없음) | `attendance_claims` + `visit_claims`(주간) |
| `wk-major-{char}` | 계열 평가자산 **DESC** → 계열 비중% DESC → 계열 매매횟수 DESC | `holdings` × `stocks.owner_character` × 현재 틱가 |

### 판정 정의 (확정)

- **총자산** = `cash + Σ(holdings.quantity × 당일/마감 종가)`. 마감 시점 현재 틱가로 계산.
- **단일 종목 수익률**(도파민/펜트하우스) = **마감 시점 보유 중인** 종목의 `(현재가 − avg_price) / avg_price`. 유저별 보유 종목 중 최고/최저 하나를 대표값으로 랭킹. 마감에 아무것도 보유하지 않은 유저는 후보 제외.
- **주중 고점/저점**(기부천사/돈복사기) = 그 주 `user_asset_snapshots.total_asset`의 `max`/`min`. **일별 스냅샷 단위**(틱 단위 아님). "선착순(먼저 달성)"은 해당 max/min을 기록한 `date`가 이른 유저 우선.
- **매매 횟수/대금**(인간매크로·동점 처리) = 그 주 체결된 `trades`의 `count(*)` / `sum(체결가×수량)`.
- **VIP 합계** = 그 주 `attendance_claims`(접속 출석) 건수 + `visit_claims`(매장 방문 코드) 건수. 최댓값 동률 전원 수여.
- **계열 평가자산**(최대주주) = `holdings` join `stocks on owner_character = char`의 `Σ(quantity × 현재 틱가)`. 계열 비중% = 계열 평가자산 / 유저 총 평가액.

## 정산 트리거 (일일 배치 편입)

- **편입 지점**: `src/services/batchService.ts` — `apply_daily_batch` RPC 성공 직후, **그날이 그 주의 마지막 개장일(일요일 등)이면** `settle_weekly_badges(...)` RPC 1회 호출. 판정은 정산·틱 생성 이후라 평가액·보유가 확정된 상태.
- **자산 스냅샷 기록**: `apply_daily_batch` 말미 또는 배치 후 별도 단계에서 전 유저 `user_asset_snapshots` upsert(매일). 정산이 이 스냅샷에 의존하므로 **정산보다 먼저** 기록.
- **별도 함수 분리**: 배치 본문 수정을 최소화하려 `settle_weekly_badges()`·`snapshot_user_assets()`를 독립 함수로 떼고, 배치 서비스에서 순서대로 호출(`apply_daily_batch` → `snapshot_user_assets` → 주말이면 `settle_weekly_badges`).
- **실행시간 주의**([[batch-pgnet-timeout-failure]]): 전 유저 스냅샷·정산이 무거우면 `maxDuration`/pg_net timeout 여유 확인. 유저 수가 이벤트 규모(수십~수백)라 부담은 낮으나 인덱스로 방어.

## 서비스 · API 계층

### `src/services/weeklyBadgeService.ts` (신규)
- `listBadgeCatalog(): Promise<WeeklyBadge[]>` — 활성 12종 정의(`sort_order` 정렬).
- `getUserWeeklyBadges(userId, weekStart?): Promise<UserWeeklyBadge[]>` — 유저의 (이번 주 또는 지정 주) 보유 배지 + 정의 조인.
- `getRepresentativeBadges(userIds: number[], weekStart): Promise<Map<number, WeeklyBadge|null>>` — 랭킹·댓글 목록의 작성자별 **이번 주 대표 배지 1개** 배치 조회(N+1 방지).
- `setRepresentativeBadge(userId, badgeId)` — 본인이 **이번 주 보유한** 배지만 허용 검증.

`WeeklyBadge` DTO: `{ id, name, description, tieBreakNote, concept, category, iconUrl, isUnique, sortOrder }`. `UserWeeklyBadge`: `WeeklyBadge & { weekStart, awardedAt, metricValue }`.

### 대표 배지 저장
`users.representative_badge_id text null references weekly_badges(id)` 컬럼 추가 + 선택 API. 미선택(또는 이번 주 미보유)이면 자동 규칙(`sort_order` 우선순위 최상위 보유 배지)으로 fallback.

### API
- `GET /api/weekly-badges` → 활성 카탈로그 12종. `ApiResponse<T>` 래퍼, React Query 길게 캐시.
- `GET /api/users/me/badges`(또는 프로필 로더 편입) → 본인 이번 주 보유 배지 + (선택) 과거 주 히스토리.
- `PATCH /api/users/me/representative-badge` → 본인 이번 주 보유분만.
- 어드민 배지 관리 API 없음(카탈로그는 코드 seed 고정).

## UI 계층

- **카탈로그 훅** `useWeeklyBadges()` — `["weekly-badges"]` 쿼리로 정의 12종 1회 로드(`staleTime` 길게), id→`{name, description, iconUrl, …}` 맵.
- **프로필 배지 그리드** (신규 컴포넌트) — 12종 카드 그리드. **이번 주 보유분 강조 + 미보유는 회색 잠금**(조건·뉘앙스 툴팁으로 도전 유도). 유니코드 이모지 아님(심볼/일러스트 자산).
- **랭킹 목록 대표 배지** (`RankingSection.tsx` 등 랭킹 렌더 지점) — 닉네임 옆 이번 주 대표 배지 1개. `getRepresentativeBadges` 배치 조회.
- **댓글 작성자 대표 배지** (`StockComments.tsx` + 토론뷰 `DiscussionComment`) — 닉네임 옆 대표 배지 1개. **임베드 금지**(아래 §PostgREST 주의), 작성자 `user_id` 집합 모아 별도 배치 조회 후 앱에서 합성.
- **주 초 획득 알림**(선택·경량) — 로그인 시 지난주 새 보유 배지가 있으면 sonner 토스트/모달 "지난주 배지 획득". 정산이 배치라 실시간 체결 토스트는 없음.
- **명예의 전당/히스토리**(후속 권장) — 과거 주차 승자 목록. 스냅샷은 `weekly_badge_awards`에 이미 보존되므로 조회만 추가하면 됨(초기 범위 밖).

### PostgREST 임베드 주의 ([[postgrest-max-rows-1000-tick-pagination]]·PR#43 교훈)
댓글 조회에 배지를 직접 임베드하면 `stock_comments → users → weekly_badge_awards → weekly_badges` 다단 조인·관계 모호성(PGRST201) 위험. **대표 배지는 임베드하지 말고** 작성자 `user_id` 집합으로 `getRepresentativeBadges` 별도 배치 조회 후 합성(스티커가 `sticker_id`만 싣고 카탈로그를 분리한 것과 동일 원칙).

## 검증 · 배포

1. `npm run build` + `npx eslint src`([[worktree-build-env-gotchas]] — 워크트리 스코프 lint) 통과. 워크트리 `npm install` 선확인.
2. **verify 스킬**(dev + agent-browser, [[verify-agent-browser-7-16]])로 실앱 확인:
   - 리허설로 주 경계를 단축(오늘을 "주 마지막 개장일"로 세팅, [[rehearsal-render-chart-before-event]] 기법 응용)해 정산 1회 실행 → 12종 승자 부여 확인.
   - 프로필 12종 그리드(보유 강조 + 미보유 회색 잠금) 렌더.
   - 랭킹·댓글 작성자 옆 대표 배지 렌더, 대표 배지 유저 선택 반영.
   - VIP 동점 시 전원 수여, 나머지 11종은 1인 독점 확인.
   - 배치 2회 실행에도 중복 부여 없음(주차 delete-후-재삽입 멱등).
3. 마이그레이션 **prod push** + **리허설 재생성**([[rehearsal-reset-before-open]], [[sector-overhaul-deploy-lessons]]) — 코드 배포(main 머지→Vercel)가 배치보다 먼저. `weekly_badges`·`stocks.owner_character` seed는 prod에도 반영, `weekly_badge_awards`·`user_asset_snapshots`는 cascade 정리.
4. `reset_rehearsal_data` 재정의에 `delete from weekly_badge_awards where true;`·`delete from user_asset_snapshots where true;` 추가([[sector-overhaul-deploy-lessons]] FK 갱신 규약 — 최신 정의 계보 누적 반영).
5. **시뮬 영향 없음**(현금가치 0) — `npm run simulate` 재검증 불필요.

## 범위 밖 (YAGNI / 후속)

- 명예의 전당/과거 주차 히스토리 UI — 스냅샷은 보존하되 조회 화면은 후속.
- 주간 정산 실시간 푸시 알림, 배지별 랭킹 상세, 배지 진행률 바 — 하지 않음.
- 유저 커스텀 배지, 배지 거래/증정 — 하지 않음.
- 어드민 배지 편집(카탈로그는 코드 seed 고정).
- 스텁 주(8/1~8/2) 특수 연출 — 일반 주와 동일 처리.

## 병렬 구현 시 다른 기능과의 표면 겹침 (충돌 지점)

- **일일 배치(`batchService`·`apply_daily_batch`):** 스냅샷·정산 단계를 새로 편입 → 다른 배치 편집과 같은 파일. `snapshot_user_assets()`·`settle_weekly_badges()`를 **별도 함수**로 떼어 배치 본문 수정 최소화.
- **프로필/랭킹/댓글 렌더:** 대표 배지는 스티커(댓글 본문 스티커)와 **같은 댓글 렌더 지점**(`StockComments.tsx`·`DiscussionComment`)을 수정 → 동시 편집 충돌 가능. 병렬 시 한쪽 머지 후 다른 쪽 리베이스.
- **마이그레이션 번호:** 스티커와 `20260718090000_*.sql` 충돌 시 나중 머지 쪽이 다음 타임스탬프로 리네임.
- **`reset_rehearsal_data` 재정의:** 스트릭·스티커·배지가 각자 `delete` 한 줄씩 추가하며 함수 전체를 재정의 → 마이그레이션 겹치면 **최신 정의 계보에 이전 delete들을 모두 포함**([[sector-overhaul-deploy-lessons]]).
- **`stocks` 테이블 ALTER:** `owner_character` 컬럼 추가 — 다른 stocks ALTER와 순서 유의(논리 충돌은 없음).
- **`users` 테이블 ALTER:** `representative_badge_id` 컬럼 추가 — 온보딩이 `users.onboarded_at`을 추가할 수 있어 같은 테이블 ALTER 겹칠 수 있음(각자 다른 컬럼, 순서만 유의).

## 열린 결정 (없음)

브레인스토밍에서 전부 확정: 방향(주간 전면 교체), 주차 경계(달력 주·월요일 정산), 12종 세트(문서 그대로), 소유권(주차별 1인·VIP 동점 전원), 캐릭터 매핑(위 확정), 수익률 정의(마감 보유 평가수익률), 자산 스냅샷(일별), 대표 배지(유저 선택·자동 fallback), 미보유 노출(회색 잠금).

# Phase D — 댓글 대댓글(중첩 스레드) + 루머 "검증 안됨" 배지 설계

> 작성일 2026-07-19 · 브랜치 `worktree-feat+ui-tweaks` · UI 개선 로드맵 Phase D
> 선행 문서: `docs/RESEARCH-ui-redesign.md` §4 Phase D

## 배경

Phase D 로드맵은 소셜 몰입 기능(PR#42 출석 스트릭 · PR#43 소셜 확장 · 스티커)이
구현되기 *전*에 작성되어, 원안 4개 항목 중 일부는 이미 완료돼 있다.

| Phase D 원안 항목 | 현재 상태 |
|---|---|
| 뉴스 반응 바 (엄지업/다운) | ✅ 완료 (PR#43, `news_reactions`) |
| 뉴스 호재/악재 투표 + 집계 막대 | 이번 범위에서 **제외** (노이즈 관리) |
| 댓글 중첩 스레드(대댓글) | ❌ 본 작업 대상 |
| 스티커 집계 리액션(Slack식) | 이번 범위에서 **제외** |
| 루머 "검증 안됨" 배지 강화 | ❌ 본 작업 대상 |

**확정 범위(사장님):** ① 댓글 대댓글(중첩 스레드) ② 루머 "검증 안됨" 배지.
호재/악재 투표·스티커 집계 리액션은 상품 걸린 이벤트의 소셜 노이즈 관리 차원에서 제외.

## 목표

1. 종목 토론방 댓글에 **2단계 평톤 대댓글**을 추가해 대화가 이어지도록 한다.
2. 찌라시(루머) 등급 뉴스에 **"미확인" 배지**를 붙여 신뢰도 경고를 강화한다.

---

## 1. 데이터 모델 (마이그레이션 1종)

새 마이그레이션 `supabase/migrations/20260719000000_comment_threads.sql`:

```sql
-- 대댓글: 자기참조 parent_id. 2단계 제한은 서비스 레이어에서 강제
alter table stock_comments
  add column parent_id bigint null references stock_comments (id) on delete cascade;

-- 소프트 삭제(묘비): 답글이 달린 부모를 삭제해도 스레드를 보존
alter table stock_comments
  add column deleted_at timestamptz null;

-- 최상위 댓글의 답글을 created_at asc(대화 흐름)로 조회하기 위한 인덱스
create index stock_comments_parent_idx on stock_comments (parent_id, created_at asc);

-- 묘비 행은 content·sticker 둘 다 null이 되므로 has_body 제약 완화
alter table stock_comments drop constraint if exists stock_comments_has_body;
alter table stock_comments add constraint stock_comments_has_body
  check (deleted_at is not null or content is not null or sticker_id is not null);
```

**설계 근거**
- `parent_id` 하나만 추가. `NULL` = 최상위, 값 = 그 댓글의 답글.
- **2단계 강제**: 답글(=parent_id 존재)에는 다시 답글을 달 수 없다. 서비스가 부모의
  `parent_id`가 이미 채워져 있으면 거부한다. 답글의 답글은 UI에서 `@닉네임`을 본문 앞에
  자동 삽입해 **같은 스레드에 평톤으로** 붙인다 → 별도 멘션 컬럼 불필요.
- `on delete cascade`(자기참조): 부모를 **하드 삭제**하면 답글도 함께 사라진다. 단
  아래 삭제 정책에 따라 답글이 있는 부모는 하드 삭제하지 않고 소프트 삭제(묘비)한다.

## 2. 삭제 정책 (묘비)

| 대상 | 답글 유무 | 처리 |
|---|---|---|
| 최상위 댓글 | 답글 있음 | **소프트 삭제** — `deleted_at=now()`, `content=null`, `sticker_id=null` → "삭제된 댓글입니다" 묘비 + 답글 보존 |
| 최상위 댓글 | 답글 없음 | 하드 삭제 |
| 답글 | (2단계라 자식 없음) | 항상 하드 삭제 |

- 본인 삭제·어드민 삭제 모두 동일 규칙.
- 묘비 행은 작성자/배지/좋아요/수정/답글달기 UI를 전부 숨기고, 회색 안내문만 남긴다.
- 스티커 하드 삭제 시 기존 `on delete set null`은 그대로 유효(묘비와 무관).

## 3. 서버 (`src/services/commentService.ts`)

### 타입
```ts
export interface StockComment {
  id: number;
  nickname: string;
  content: string | null;
  createdAt: string;
  mine: boolean;
  likeCount: number;
  likedByMe: boolean;
  representativeBadge: WeeklyBadge | null;
  stickerId: string | null;
  deleted: boolean;          // 묘비 여부 (deleted_at != null)
  replies?: StockComment[];  // 최상위 댓글에만 채워짐 (답글은 없음)
}
```

### `listComments(stockCode, viewerId)`
- 한 종목의 모든 댓글(부모+답글)을 조회한 뒤 앱에서 **중첩 조립**:
  - 최상위(parent_id null)는 `created_at desc`(현행 유지, 최신순)
  - 각 부모의 `replies`는 `created_at asc`(대화 흐름, 오래된→최신)
- 좋아요·대표배지 집계는 **부모+답글 id 전체를 한 번에** 조회(기존 `likeSummary` /
  `representativeBadgesFor` 배치 패턴 그대로, N+1 없음).
- 묘비(`deleted_at != null`)는 `content=null, deleted=true`로 내려보내되 `replies`는 유지.
- 페이지네이션: 현행 `PAGE_SIZE=30`은 **최상위 댓글 기준**으로 적용(답글은 부모에 종속되어
  전량 반환). 답글 수가 폭증하는 경우는 이벤트 규모상 없다고 판단 — YAGNI.

### `createComment(userId, stockCode, content, stickerId, parentId?)`
- `parentId`가 있으면: 부모 존재 확인 + 부모의 `parent_id`가 null인지(=최상위인지) 검증.
  답글에 답글이면 `VALIDATION` 거부. 부모가 묘비면 거부.
- 도배 제한(최근 1분 5개)은 **부모·답글 공통** 집계(현행 그대로).

### `deleteComment` / `adminDeleteComment`
- 삭제 대상에 답글이 있는지 조회 → 있으면 소프트 삭제(update `deleted_at`, content/sticker null),
  없으면 하드 삭제. (답글은 자식이 없으므로 항상 하드 삭제 경로)

### `listAllComments` (전체 토론 피드용)
- **최상위 댓글만** 반환하도록 `.is("parent_id", null)` 필터 추가.
- 각 항목에 `replyCount`(자식 수) 필드 추가 — 읽기 전용 개수 뱃지용.
- 묘비도 목록에 포함하되 `deleted=true`로 표시(답글 개수 맥락 유지).

## 4. API (`src/app/api/stocks/[code]/comments/route.ts`)

- `createSchema`에 `parentId: z.number().int().positive().optional()` 추가.
- POST 핸들러가 `parsed.data.parentId`를 `createComment`에 전달.
- GET/PATCH/DELETE/like 라우트는 시그니처 불변(중첩은 응답 구조로만 반영).

## 5. UI — 종목 토론방 (`src/components/trade/StockComments.tsx`)

- 최상위 댓글 렌더는 현행 유지. 그 아래에:
  - 답글이 있으면 **"답글 N개 보기 / 숨기기"** 토글(기본 접힘).
  - 펼치면 답글 목록(좌측 들여쓰기 1단계 + `border-l` 연결선) + **답글 입력창**.
  - 각 댓글에 **"답글" 버튼** 추가. 탭 시 해당 스레드의 입력창을 열고,
    답글의 답글이면 `@작성자 `를 입력값에 자동 프리필(편집 가능).
- 답글도 좋아요·스티커·수정·삭제를 최상위와 동일하게 지원(같은 행 타입).
- **묘비 렌더**: `deleted`면 작성자/액션 없이 `"삭제된 댓글입니다"` 회색 문구만, 그 아래 답글 유지.
- 헤더 카운트 `N개`는 **묘비 제외 전체(부모+답글)** 수. (서버가 total 계산해 내려주거나 클라 합산)
- 답글 입력 상태는 `replyingTo: number | null`(열린 스레드의 부모 id)로 관리. 한 번에 하나만 열림.
- 폴링(10초)·낙관적 무효화(invalidateQueries)는 현행 그대로.

## 6. UI — 전체 토론 피드 (`src/components/news/DiscussionList.tsx`)

- 읽기 전용 성격 유지 → **최상위 댓글만**, 각 카드에 **"답글 N"** 개수만 노출(작성/펼치기 없음).
- 답글을 보려면 종목 상세로 이동(기존 종목 태그 링크 활용).
- 묘비는 "삭제된 댓글입니다"로 표시하되 답글 개수는 유지.

## 7. UI — 루머 "미확인" 배지 (`src/components/news/NewsList.tsx`)

- `GRADE_META`에 `label?: string` 확장. `rumor`에만 `label: "미확인"` 지정.
- 게시물 헤더 핸들 옆(또는 날짜 뒤)에 **테두리만 있는 뮤트 톤 칩**으로 렌더:
  `border border-border text-muted-foreground` · 이모지 없음([[no-emoji-in-ui]] 준수).
- compact/full 양쪽 노출. `disclosure`·`news`는 기존 `BadgeCheck`(인증) 유지, 변화 없음.

---

## 비목표 (이번 범위 밖)

- 뉴스 호재/악재 투표 + 집계 막대 (별도 결정 필요, 노이즈 관리로 보류)
- 스티커 Slack식 집계 리액션 (현행 첨부 방식 유지)
- 답글의 답글 실제 3단계 들여쓰기 (2단계 평톤 + @멘션으로 대체)
- 답글 페이지네이션 (전량 반환, 이벤트 규모상 불필요)

## 검증 계획

- `npm run build` + `npx eslint src` 통과([[worktree-build-env-gotchas]]: 워크트리 npm install, lint 스코프).
- 로컬 supabase reset 후 마이그레이션 적용 확인. `reset_rehearsal_data`는 `stock_comments`
  cascade로 자동 정리되므로 무수정(FK 확인).
- verify 스킬(agent-browser)로 실앱 검증: 댓글 작성 → 답글 → 답글의 답글(@멘션 평톤) →
  답글 있는 부모 삭제 시 묘비 + 답글 보존 → 루머 뉴스 "미확인" 배지 노출.
- **배포 주의:** 마이그 `20260719000000` prod push + 리허설 재생성 필요([[rehearsal-reset-before-open]]).
  PostgREST 임베드 모호성(PGRST201) 경계 — 자기참조 조인은 임베드하지 말고 앱에서 조립([[postgrest-max-rows-1000-tick-pagination]] 계열 교훈).

## 열린 결정 (스펙 리뷰 시 확인)

- 없음 — 삭제 정책(묘비)·중첩 깊이(2단계)·범위(대댓글+루머 배지) 모두 확정됨.

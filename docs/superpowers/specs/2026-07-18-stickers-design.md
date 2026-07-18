# 스티커 기능 설계 (몰입 로드맵 §2-4)

**작성일:** 2026-07-18
**브랜치:** `feat/stickers` (워크트리)
**상위 스펙:** `docs/superpowers/specs/2026-07-18-immersion-features-design.md` §2-4
**선행 완료:** 출석 스트릭(PR#42), 소셜확장 3종(PR#43 — 댓글 엄지업·토론 세그먼트·뉴스 반응)

## 목적

종목 토론방 댓글에 **제작진 큐레이션 스티커**(세계관 캐릭터 짤 + 웃긴 짤)를 붙일 수 있게 한다. 자유 이미지 업로드는 막아 모더레이션 부담을 없애고, 큐레이션 세트는 **사장님이 어드민에서 배포 없이 언제든 추가**할 수 있게 한다.

- 스티커는 **현금가치 0** → 밸런스·시뮬 영향 없음. 공정성 안전.
- 스티커=이미지 자산이므로 [[no-emoji-in-ui]](유니코드 이모지 금지)와 별개.

## 핵심 결정 (브레인스토밍 확정)

1. **첨부 방식:** 텍스트+스티커 둘 다 가능, **스티커 단독 댓글도 허용**. → `stock_comments.content`를 nullable로 완화하고 "텍스트·스티커 중 최소 하나" 제약을 건다.
2. **카탈로그 저장(1단계):** **DB 테이블 + 이미지 data URI(base64)**. 어드민에서 PNG를 올리면 즉시 라이브(배포 불필요), Supabase Storage(현재 비활성)를 켜지 않는다. 소규모 큐레이션 세트에 최적.
3. **2단계 이관 대비:** 소비 코드(댓글·피커)는 오직 `imageUrl`만 본다. 스티커가 수백 개+대용량으로 늘면 `stickers`에 `storage_path`를 추가하고 서비스가 Storage 공개 URL을 `imageUrl`로 반환 → 댓글·피커 **무수정**으로 이관.
4. **자산 상태:** 실제 캐릭터 짤은 병렬 제작 중. 지금은 **임시 스티커 1개**(placeholder)만 seed로 넣고, 기능을 끝까지 완성한다. 실제 PNG는 어드민으로 추가.

### 왜 data URI 먼저인가 (요약)
- 저장/전송량 모두 이 이벤트 규모(참가자 수십~수백, 스티커 수십 개, 개당 ~20KB)에서 Supabase Free 한도의 먼지 수준 → **비용은 결정 요인이 아님**.
- data URI는 기존 DB만 쓰므로 추가 인프라 0. Storage는 버킷·RLS 정책·업로드 API를 새로 검증해야 해 개장(7/28) 리스크가 큼.
- **2단계 트리거:** 스티커 수백 개+대용량, 또는 카탈로그 fetch 체감 지연, 또는 DB 용량 압박 시 Storage 이관.

## 데이터 모델 (마이그레이션 1종)

신규 테이블 `stickers`:

```sql
create table stickers (
  id text primary key,           -- 슬러그 (예: 'okja-cry')
  label text not null,           -- 접근성/피커 라벨 (예: '우는 옥자')
  image_data_uri text not null,  -- data:image/png;base64,....  (2단계에서 storage_path로 확장)
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table stickers enable row level security;
alter table stickers force row level security;  -- service role만 통과 (기존 테이블 규약 동일)

create index stickers_active_idx on stickers (is_active, sort_order);
```

`stock_comments` 변경:

```sql
alter table stock_comments
  add column sticker_id text null references stickers (id) on delete set null;

-- content를 nullable로 완화 (스티커 단독 댓글 허용)
alter table stock_comments alter column content drop not null;

-- 기존 char_length(content) between 1 and 200 체크를 재정의:
--   content가 있으면 1~200자, 없어도 됨
-- 인라인 check라 Postgres 자동 명명 stock_comments_content_check 로 추정 —
-- 마이그레이션 작성 시 `\d stock_comments`로 실제 제약명 확인 후 drop.
alter table stock_comments drop constraint stock_comments_content_check;
alter table stock_comments add constraint stock_comments_content_len
  check (content is null or char_length(content) between 1 and 200);

-- 텍스트·스티커 중 최소 하나는 있어야 함
alter table stock_comments add constraint stock_comments_has_body
  check (content is not null or sticker_id is not null);
```

- 기존 제약명은 마이그레이션 작성 시 `\d stock_comments`로 확인해 정확히 명시한다(현재 인라인 `check`라 자동 생성명일 수 있음).
- `on delete set null`: 스티커를 하드 삭제해도 기존 댓글은 텍스트만 남고 깨지지 않는다. 단 운영 기본은 **soft-deactivate(`is_active=false`)** — 비활성 스티커는 피커에서 숨기되 기존 댓글엔 계속 렌더된다(행이 남아 있으므로).
- **리허설/reset 영향:** 컬럼·테이블 추가라 기존 cascade 그대로. `stickers`는 reset 시 seed로 임시 1개 재삽입.

### seed (`supabase/seed.sql`)
임시 placeholder 스티커 1개 삽입:
```sql
insert into stickers (id, label, image_data_uri, sort_order) values
  ('placeholder-01', '임시 스티커', 'data:image/svg+xml;base64,<작은 심볼 SVG>', 0);
```
(작은 인라인 SVG를 base64로. 실제 캐릭터 짤은 어드민에서 추가.)

## 서비스 계층

### `src/services/stickerService.ts` (신규)
- `listStickers(activeOnly: boolean): Promise<Sticker[]>` — 피커(활성만)·어드민(전체) 공용. `sort_order, created_at` 정렬.
- `createSticker(input): Promise<void>` — 어드민 전용. **검증:** `id` 슬러그 형식, `image_data_uri`가 `data:image/(png|jpeg|webp|svg+xml);base64,` 접두로 시작, **디코딩 용량 ≤ 100KB**(상한), `label` 비어있지 않음.
- `updateSticker(id, patch)` / `setStickerActive(id, active)` / `deleteSticker(id)` — 어드민 전용.
- `assertValidStickerId(id: string): Promise<void>` — 존재 + `is_active` 검증. 댓글 작성 시 사용.

`Sticker` DTO: `{ id, label, imageUrl, sortOrder, isActive }` (`imageUrl`은 지금 `image_data_uri` 그대로, 2단계에서 Storage URL).

### `src/services/commentService.ts` (확장)
- `createComment(userId, stockCode, content, stickerId?)` — 텍스트·스티커 중 최소 1개 필수(둘 다 없으면 `VALIDATION`), `stickerId` 있으면 `assertValidStickerId`. 기존 도배 제한·종목 검증 유지.
- `updateComment(userId, commentId, content, stickerId?)` — 스티커 변경/제거 반영. 편집 후에도 "최소 하나" 제약 유지.
- `StockComment`·`DiscussionComment` DTO에 `stickerId: string | null` 추가.
- `listComments`·`listAllComments` select에 `sticker_id` 포함. **주의: 댓글엔 이미지 데이터를 싣지 않고 `stickerId`만** 반환한다(payload 최소화 + Storage 이관 무관).

## API 계층

- `GET /api/stickers` → 활성 카탈로그 `{ id, label, imageUrl }[]`. `ApiResponse<T>` 래퍼. 클라이언트가 React Query로 1회 캐시.
- `POST /api/stocks/[code]/comments` — body Zod에 `stickerId?: string` 추가. `PATCH`(수정)도 동일.
- 어드민 CRUD: `/api/admin/stickers` (`GET`/`POST`/`PATCH`/`DELETE`) — 기존 `/api/admin/*` 인증·패턴 재사용. 어드민 여부는 기존 가드로 판정.
- 댓글 응답 DTO에 `stickerId` 포함.

## UI 계층

- **카탈로그 훅** `useStickers()` — `["stickers"]` 쿼리로 활성 세트 1회 로드, `staleTime` 길게. id→`{label, imageUrl}` 맵 제공.
- **`StickerPicker`** (신규, `src/components/trade/`) — 입력창 옆 아이콘 버튼(lucide, 유니코드 이모지 아님) → shadcn `Popover` 그리드. 선택 시 상위에 선택 id 전달. 선택된 스티커는 입력창 위 미리보기 + 제거(X).
- **`StockComments.tsx`** (확장) — 피커 연결, 전송 시 `stickerId` 동봉, `content`·스티커 둘 중 하나만 있어도 전송 허용. 렌더: 텍스트 아래 카탈로그 맵으로 `<img>`(고정 크기, 예: 96px). 편집 시 스티커도 교체/제거 가능.
- **토론뷰**(전종목 댓글 모음) — 같은 카탈로그 맵으로 렌더만 적용(작성은 종목 상세에서). `DiscussionComment` 렌더 지점에 스티커 표시 추가.
- **어드민 스티커 관리** (신규, `src/components/admin/` + `/admin` 편입) — 목록(활성/비활성), 추가(로컬 PNG 선택 → **클라이언트에서 base64 인코딩** → 라벨·슬러그 입력 → 저장), 활성 토글, 삭제, `sort_order` 조정. **저장 즉시 피커 반영**(배포 불필요).

## 운영 · 모더레이션

- 자유 업로드 없음(큐레이션만) → 유저측 모더레이션 부담 0.
- 부적절 댓글은 기존 어드민 삭제(`adminDeleteComment`)·계정 정지(`is_banned`)로 커버(댓글 통째 삭제 → 스티커도 함께 사라짐).
- 비로그인은 스티커 렌더만 보이고, 작성 시도 시 기존 로그인 유도 흐름.

## 검증 · 배포

1. `npm run build` + `npm run lint` 통과.
2. **verify 스킬**(dev + agent-browser)로 실앱 확인:
   - 텍스트+스티커 댓글 작성·렌더.
   - **스티커 단독** 댓글 작성·렌더.
   - 어드민에서 스티커 추가 → **피커에 즉시 노출** → 댓글에 사용.
   - 토론뷰에서 스티커 렌더.
   - 스티커 삭제/비활성 시 기존 댓글 안 깨짐.
3. 마이그레이션 **prod push** + **리허설 재생성**([[rehearsal-reset-before-open]]) — 테이블/컬럼 추가는 cascade 유지, seed에 임시 1개.
4. 시뮬 영향 없음(현금가치 0) — `npm run simulate` 재검증 불필요.

### PostgREST 임베드 주의 ([[postgrest-max-rows-1000-tick-pagination]]·PR#43 교훈)
`stock_comments`에 `stickers` FK가 추가되지만, **댓글 조회는 스티커를 임베드하지 않고 `sticker_id`만 select**하므로 PGRST201류 모호성 위험이 없다(카탈로그는 별도 `/api/stickers`로 조회). 기존 `users!stock_comments_user_id_fkey` 명시는 유지.

## 범위 밖 (YAGNI / 후속)

- Supabase Storage 이관(2단계) — 스티커 대량화 시 별도 작업. 설계상 `imageUrl` 추상화로 대비 완료.
- 스티커 반응/랭킹, 유저 자유 업로드, 애니메이션 스티커 — 하지 않음.
- 배지·온보딩 — 각자 별도 스펙([[immersion-benchmark-research]] 로드맵).

## 후속 로드맵 연계

스티커 다음 순서는 **배지·타이틀 → 경량 온보딩**. 상위 스펙 §③·§④에 스케치만 존재하므로 각각 별도 브레인스토밍·스펙이 필요하다. 스티커 워크트리와 **병렬 진행 가능**(표면 겹침 분석은 구현 계획 단계에서):
- 스티커는 댓글·어드민에 국한돼 **가장 독립적** → 병렬 안전.
- 배지는 일일 배치·프로필/랭킹 표면을 건드림 → 자체 워크트리 필요.
- 온보딩은 프론트 툴팁 위주라 독립적이나, 붙일 대상 기능이 있어야 의미 → 순서상 마지막.

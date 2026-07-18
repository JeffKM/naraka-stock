# 소셜확장(3종) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 종목 댓글(`stock_comments`)과 뉴스 피드를 확장해 ①댓글 엄지업 ②뉴스탭 ⟨뉴스\|토론⟩ 세그먼트 ③뉴스 카드 엄지업/엄지다운 반응 3종을 구현한다. (스티커·배지·온보딩은 이번 범위 밖.)

**Architecture:** 원본 데이터는 `stock_comments` 하나로 유지(대화 파편화 방지)하고, 반응만 신규 테이블 2종(`comment_reactions`, `news_reactions`)으로 분리한다. 반응 집계·토글은 전부 서버(service role)에서 처리하고, 클라이언트는 표시·토글 요청만 한다. 반응은 현금가치 0이라 밸런스 시뮬 영향 없음. 토론 세그먼트는 전 종목 댓글을 시간순으로 합친 읽기 전용 집약 뷰(작성은 종목 상세에서만).

**Tech Stack:** Supabase(Postgres + RLS), Next.js 16 App Router, React 19, TanStack Query v5, shadcn/ui, lucide-react, sonner.

## Global Constraints

- **반응 집계·토글은 서버에서** — 카운트·본인 반응 여부는 service role 쿼리로 산출. 클라가 보내는 카운트 불신.
- **비현금 = 시뮬 무관** — 엄지업/다운은 현금가치 0. `npm run simulate` 재검증 불필요.
- **UI 유니코드 이모지 금지** ([[no-emoji-in-ui]]) — 반응은 lucide `ThumbsUp`/`ThumbsDown` **아이콘**으로(이모지 아님). 텍스트 라벨("믿는다/좋아요") 없이 아이콘+카운트만.
- **캐논 어휘 금지** — 문안에 저승·천계·도깨비·염라 등 확장 어휘 파생어 금지.
- **TypeScript strict** — `any` 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트, 개별 임포트, 경로 alias `@/*`.
- **API 응답은 `ApiResponse<T>` 래퍼** — `apiOk`/`apiError`/`handleApiError` 사용. 코드 주석·커밋은 한국어.
- **비로그인 처리** — 반응 카운트는 누구나 조회. 토글은 `requireUser`(미로그인 시 401). UI는 미로그인 시 로그인 유도.
- **검증 방식** — 이 프로젝트는 유닛 테스트 프레임워크가 없다. DB는 `psql`로 시나리오 검증, TS는 `npm run build` + `npm run lint`, UI는 verify 스킬(dev + agent-browser)로 검증한다.
- **마이그레이션 배포** — 신규 테이블 2종은 [[rehearsal-reset-before-open]] 재생성 + prod push 절차 필요. FK는 둘 다 `on delete cascade`라 `reset_rehearsal_data`가 users/news 삭제 시 자동 정리(별도 수정 불필요).

---

## File Structure

- **Create** `supabase/migrations/20260718070000_social_reactions.sql` — `comment_reactions`·`news_reactions` 테이블 2종(RLS force, FK cascade).
- **Modify** `src/services/commentService.ts` — `StockComment`에 `likeCount`/`likedByMe` 추가, `listComments` 집계, `toggleCommentLike`, `listAllComments`(전 종목 토론뷰) 추가.
- **Create** `src/app/api/comments/[id]/like/route.ts` — 댓글 엄지업 토글(`POST`).
- **Create** `src/app/api/comments/route.ts` — 전 종목 댓글 목록(`GET`, 토론뷰용).
- **Modify** `src/components/trade/StockComments.tsx` — 댓글 행에 엄지업 버튼+카운트.
- **Create** `src/components/news/DiscussionList.tsx` — 전 종목 댓글 시간순 뷰(종목 태그 칩 + 엄지업).
- **Modify** `src/app/news/page.tsx` — ⟨뉴스\|토론⟩ 세그먼트 토글 + 토론뷰 분기.
- **Modify** `src/services/newsService.ts` — `NewsFeedItem`(반응 필드) 타입, `getNewsFeed`에 `viewerId`+집계, `toggleNewsReaction` 추가.
- **Modify** `src/app/api/news/route.ts` — 세션 `viewerId` 전달.
- **Create** `src/app/api/news/[id]/reaction/route.ts` — 뉴스 반응 토글(`POST`).
- **Modify** `src/components/news/NewsList.tsx` — 카드 푸터에 엄지업/엄지다운 버튼+카운트.

---

## Task 1: DB 마이그레이션 (반응 테이블 2종)

**Files:**
- Create: `supabase/migrations/20260718070000_social_reactions.sql`
- 참조(패턴): `supabase/migrations/20260713100000_stock_comments.sql`, `supabase/migrations/20260711000000_init_schema.sql:118-129`(news 테이블)

**Interfaces:**
- Produces: 테이블 `comment_reactions(comment_id bigint, user_id bigint)` PK(comment_id, user_id); `news_reactions(news_id bigint, user_id bigint, kind text)` PK(news_id, user_id), kind ∈ {'up','down'}. 둘 다 FK `on delete cascade`.

- [ ] **Step 1: 마이그레이션 파일 작성**

Create `supabase/migrations/20260718070000_social_reactions.sql`:

```sql
-- 소셜확장 반응 테이블 (몰입 스펙 2026-07-18 §2-1, §2-3)
--
-- 원본 대화는 stock_comments 하나로 유지하고, 반응만 분리한다.
-- comment_reactions: 댓글 엄지업(1인 1회, 방향 없음 = 존재/부재 토글).
-- news_reactions: 뉴스 카드 엄지업/엄지다운(1뉴스당 1방향, 재클릭 토글·전환).
-- 둘 다 FK on delete cascade → 유저·댓글·뉴스 삭제 시 자동 정리
-- (reset_rehearsal_data가 users/news를 지우면 반응도 따라 사라져 별도 수정 불필요).

create table comment_reactions (
  comment_id bigint not null references stock_comments (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index comment_reactions_comment_idx on comment_reactions (comment_id);

create table news_reactions (
  news_id bigint not null references news (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  kind text not null check (kind in ('up', 'down')),
  created_at timestamptz not null default now(),
  primary key (news_id, user_id)
);

create index news_reactions_news_idx on news_reactions (news_id);

-- 다른 테이블과 동일하게 RLS 전면 차단 (service role만 통과)
alter table comment_reactions enable row level security;
alter table comment_reactions force row level security;
alter table news_reactions enable row level security;
alter table news_reactions force row level security;
```

- [ ] **Step 2: 로컬 DB 리셋으로 마이그레이션 적용 검증**

Run: `npx supabase db reset`
Expected: 에러 없이 완료. 마지막 줄에 `Applying migration 20260718070000_social_reactions.sql...` 포함.

- [ ] **Step 3: 테이블·제약 생성 확인 (psql)**

Run:
```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -c "\d comment_reactions" -c "\d news_reactions"
```
Expected: 두 테이블 모두 출력. `news_reactions`에 `kind` check 제약(`up`/`down`), 각 테이블 복합 PK, FK `ON DELETE CASCADE` 표시.

- [ ] **Step 4: cascade 동작 확인 (psql)**

Run:
```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" <<'SQL'
-- 임의 유저/댓글/뉴스가 있다고 가정하지 않고, 존재 검증만: FK 위반이 정상 차단되는지
insert into comment_reactions (comment_id, user_id) values (999999, 999999);
SQL
```
Expected: `insert or update on table "comment_reactions" violates foreign key constraint` 에러(없는 댓글/유저 차단됨을 확인). 정상.

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/20260718070000_social_reactions.sql
git commit -m "feat: 소셜 반응 테이블(comment_reactions·news_reactions) 추가"
```

---

## Task 2: 댓글 엄지업 — 서비스 + API

**Files:**
- Modify: `src/services/commentService.ts`
- Create: `src/app/api/comments/[id]/like/route.ts`

**Interfaces:**
- Consumes: Task 1의 `comment_reactions` 테이블. 기존 `getSupabaseAdmin`, `ApiException`.
- Produces:
  - `interface StockComment`에 `likeCount: number`, `likedByMe: boolean` 필드 추가(Task 3 UI가 소비).
  - `toggleCommentLike(userId: number, commentId: number): Promise<{ liked: boolean; likeCount: number }>` (API가 소비).
  - `listComments`는 시그니처 불변, 반환 객체에 위 두 필드 포함.

- [ ] **Step 1: `StockComment` 인터페이스에 반응 필드 추가**

Modify `src/services/commentService.ts` — `StockComment` 인터페이스:

```ts
export interface StockComment {
  id: number;
  nickname: string;
  content: string;
  createdAt: string;
  mine: boolean; // 내가 쓴 댓글 (삭제 버튼 노출용)
  likeCount: number; // 엄지업 수
  likedByMe: boolean; // 내가 엄지업 눌렀는지 (미로그인 시 항상 false)
}
```

- [ ] **Step 2: 반응 집계 헬퍼 + `listComments` 확장**

Modify `src/services/commentService.ts` — 파일 상단 `listComments` 위에 헬퍼 추가하고, `listComments`가 이를 사용하도록 교체:

```ts
// 댓글 id 목록의 엄지업 수 + 뷰어 본인 반응 여부를 한 번에 집계한다.
// 소규모(페이지당 30개)이므로 반응 행을 전부 가져와 JS에서 합산한다.
async function likeSummary(
  commentIds: number[],
  viewerId: number | null
): Promise<Map<number, { count: number; mine: boolean }>> {
  const summary = new Map<number, { count: number; mine: boolean }>();
  if (commentIds.length === 0) return summary;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("comment_reactions")
    .select("comment_id, user_id")
    .in("comment_id", commentIds);
  if (error) throw error;
  for (const row of data) {
    const entry = summary.get(row.comment_id) ?? { count: 0, mine: false };
    entry.count += 1;
    if (viewerId !== null && row.user_id === viewerId) entry.mine = true;
    summary.set(row.comment_id, entry);
  }
  return summary;
}
```

그리고 기존 `listComments`의 `return data.map(...)` 블록을 다음으로 교체:

```ts
  const likes = await likeSummary(
    data.map((row) => row.id),
    viewerId
  );
  return data.map((row) => {
    const like = likes.get(row.id);
    return {
      id: row.id,
      nickname:
        (row.users as unknown as { nickname: string } | null)?.nickname ?? "(탈퇴)",
      content: row.content,
      createdAt: row.created_at,
      mine: viewerId !== null && row.user_id === viewerId,
      likeCount: like?.count ?? 0,
      likedByMe: like?.mine ?? false,
    };
  });
```

- [ ] **Step 3: `toggleCommentLike` 추가**

Modify `src/services/commentService.ts` — `adminDeleteComment` 아래에 추가:

```ts
// 댓글 엄지업 토글: 이미 눌렀으면 취소, 아니면 추가. 새 상태와 카운트를 돌려준다.
export async function toggleCommentLike(
  userId: number,
  commentId: number
): Promise<{ liked: boolean; likeCount: number }> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: selError } = await supabase
    .from("comment_reactions")
    .select("comment_id")
    .eq("comment_id", commentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (selError) throw selError;

  if (existing) {
    const { error } = await supabase
      .from("comment_reactions")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    // 없는 댓글이면 FK 위반 → NOT_FOUND로 변환
    const { error } = await supabase
      .from("comment_reactions")
      .insert({ comment_id: commentId, user_id: userId });
    if (error) {
      throw new ApiException("NOT_FOUND", "없는 댓글입니다.");
    }
  }

  const { count, error: countError } = await supabase
    .from("comment_reactions")
    .select("comment_id", { count: "exact", head: true })
    .eq("comment_id", commentId);
  if (countError) throw countError;

  return { liked: !existing, likeCount: count ?? 0 };
}
```

- [ ] **Step 4: 엄지업 토글 API route 작성**

Create `src/app/api/comments/[id]/like/route.ts`:

```ts
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { toggleCommentLike } from "@/services/commentService";

type RouteContext = { params: Promise<{ id: string }> };

// 댓글 엄지업 토글 (로그인 필요)
export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const commentId = Number(id);
    if (!Number.isInteger(commentId) || commentId <= 0) {
      return apiError("VALIDATION", "잘못된 댓글 id입니다.");
    }
    return apiOk(await toggleCommentLike(user.id, commentId));
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 5: 빌드·린트 통과 확인**

Run: `npm run build && npm run lint`
Expected: 타입/린트 에러 없이 성공.

- [ ] **Step 6: 토글 시나리오 검증 (psql)**

Run: dev 서버가 떠 있으면 실제 유저 세션이 필요하므로, 서비스 로직은 psql로 직접 검증한다. 기존 유저·댓글이 있는 로컬 DB에서:
```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" <<'SQL'
-- 시드에 유저/댓글이 없으면 스킵. 있으면 임의 1건으로 삽입→카운트→삭제 왕복 확인
select id from stock_comments limit 1; -- 대상 댓글 id 확인용
SQL
```
Expected: 댓글 id가 있으면 이후 UI(Task 3) verify로 왕복 검증. 없으면 이 단계는 Task 3에서 실앱으로 대체 확인.

- [ ] **Step 7: 커밋**

```bash
git add src/services/commentService.ts "src/app/api/comments/[id]/like/route.ts"
git commit -m "feat: 댓글 엄지업 토글 서비스·API 추가"
```

---

## Task 3: 댓글 엄지업 — UI (StockComments)

**Files:**
- Modify: `src/components/trade/StockComments.tsx`

**Interfaces:**
- Consumes: Task 2의 `StockComment`(likeCount/likedByMe 포함) DTO, `POST /api/comments/[id]/like` 응답 `{ liked, likeCount }`.

- [ ] **Step 1: 클라이언트 `StockComment` 타입에 반응 필드 반영**

Modify `src/components/trade/StockComments.tsx` — 파일 내 로컬 `interface StockComment`에 필드 추가:

```ts
interface StockComment {
  id: number;
  nickname: string;
  content: string;
  createdAt: string;
  mine: boolean;
  likeCount: number;
  likedByMe: boolean;
}
```

- [ ] **Step 2: `ThumbsUp` 아이콘 임포트 + 좋아요 토글 핸들러 추가**

Modify `src/components/trade/StockComments.tsx` — 임포트 라인에 `ThumbsUp` 추가:

```ts
import { Check, Pencil, ThumbsUp, X } from "lucide-react";
```

그리고 컴포넌트 함수 안, `remove` 함수 아래에 토글 핸들러 추가:

```ts
  async function toggleLike(c: StockComment) {
    try {
      await postJson<{ liked: boolean; likeCount: number }>(
        `/api/comments/${c.id}/like`
      );
      queryClient.invalidateQueries({ queryKey: ["comments", stockCode] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "반응에 실패했습니다.");
    }
  }
```

- [ ] **Step 3: 댓글 본문 아래 엄지업 버튼 렌더**

Modify `src/components/trade/StockComments.tsx` — 댓글 본문 `<p className="mt-0.5 break-words text-sm">{c.content}</p>` 렌더 직후(같은 `min-w-0 flex-1` div 안, 편집 중이 아닐 때)에 엄지업 버튼을 추가한다. 기존 삼항:

```tsx
                ) : (
                  <p className="mt-0.5 break-words text-sm">{c.content}</p>
                )}
```

를 다음으로 교체:

```tsx
                ) : (
                  <>
                    <p className="mt-0.5 break-words text-sm">{c.content}</p>
                    <button
                      onClick={() => toggleLike(c)}
                      aria-label={c.likedByMe ? "엄지업 취소" : "엄지업"}
                      className={`mt-1 inline-flex items-center gap-1 text-xs transition-colors ${
                        c.likedByMe
                          ? "text-primary-accent"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <ThumbsUp
                        className={`size-3.5 ${c.likedByMe ? "fill-current" : ""}`}
                      />
                      {c.likeCount > 0 && <span>{c.likeCount}</span>}
                    </button>
                  </>
                )}
```

- [ ] **Step 4: 빌드·린트 통과 확인**

Run: `npm run build && npm run lint`
Expected: 에러 없이 성공.

- [ ] **Step 5: 실앱 verify (verify 스킬)**

verify 스킬(dev + agent-browser)로 종목 상세 진입 → 댓글 작성 → 엄지업 클릭 시 채워진 아이콘+카운트 1 증가, 재클릭 시 취소(카운트 0)되는지 확인.
Expected: 토글 정상, 새로고침 후에도 상태 유지, 미로그인 시 클릭하면 로그인 유도(401 → toast).

- [ ] **Step 6: 커밋**

```bash
git add src/components/trade/StockComments.tsx
git commit -m "feat: 종목 댓글 엄지업 버튼 UI 추가"
```

---

## Task 4: 토론 세그먼트 — 전 종목 댓글 서비스 + API

**Files:**
- Modify: `src/services/commentService.ts`
- Create: `src/app/api/comments/route.ts`

**Interfaces:**
- Consumes: Task 2의 `likeSummary` 헬퍼, `StockComment` 필드.
- Produces:
  - `interface DiscussionComment`(= StockComment + `stockCode: string` + `stockName: string`) — Task 5 UI가 소비.
  - `listAllComments(viewerId: number | null, page: number): Promise<DiscussionComment[]>` — API가 소비. 페이지당 30건, `created_at desc`.

- [ ] **Step 1: `DiscussionComment` 타입 + `listAllComments` 추가**

Modify `src/services/commentService.ts` — `toggleCommentLike` 아래에 추가:

```ts
// 토론뷰용: 전 종목 댓글을 시간순으로 합쳐 종목 태그와 함께 돌려준다 (읽기 전용 집약 뷰).
export interface DiscussionComment extends StockComment {
  stockCode: string;
  stockName: string;
}

export async function listAllComments(
  viewerId: number | null,
  page: number
): Promise<DiscussionComment[]> {
  const supabase = getSupabaseAdmin();
  const from = (page - 1) * PAGE_SIZE;
  const { data, error } = await supabase
    .from("stock_comments")
    .select("id, user_id, stock_code, content, created_at, users(nickname), stocks(name)")
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;

  const likes = await likeSummary(
    data.map((row) => row.id),
    viewerId
  );
  return data.map((row) => {
    const like = likes.get(row.id);
    return {
      id: row.id,
      nickname:
        (row.users as unknown as { nickname: string } | null)?.nickname ?? "(탈퇴)",
      content: row.content,
      createdAt: row.created_at,
      mine: viewerId !== null && row.user_id === viewerId,
      likeCount: like?.count ?? 0,
      likedByMe: like?.mine ?? false,
      stockCode: row.stock_code,
      stockName:
        (row.stocks as unknown as { name: string } | null)?.name ?? row.stock_code,
    };
  });
}
```

- [ ] **Step 2: 전 종목 댓글 API route 작성**

Create `src/app/api/comments/route.ts`:

```ts
import { apiOk, handleApiError } from "@/lib/api/response";
import { getSession } from "@/lib/auth/session";
import { listAllComments } from "@/services/commentService";

// 전 종목 댓글 모아보기 (토론 세그먼트) — 비로그인도 조회, 로그인 시 mine/likedByMe 표시
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const pageParam = Number(params.get("page") ?? "1");
    const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    const session = await getSession();
    return apiOk({
      comments: await listAllComments(session?.uid ?? null, page),
      viewerIsAdmin: session?.isAdmin ?? false,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 3: 빌드·린트 통과 확인**

Run: `npm run build && npm run lint`
Expected: 에러 없이 성공.

- [ ] **Step 4: API 응답 확인 (curl)**

dev 서버 실행 중이라 가정(`npm run dev`). Run:
```bash
curl -s "localhost:3000/api/comments?page=1" | head -c 400
```
Expected: `{"success":true,"data":{"comments":[...],"viewerIsAdmin":false}}` 형태. 댓글이 있으면 각 항목에 `stockCode`/`stockName`/`likeCount` 포함.

- [ ] **Step 5: 커밋**

```bash
git add src/services/commentService.ts src/app/api/comments/route.ts
git commit -m "feat: 전 종목 댓글 모아보기(토론뷰) 서비스·API 추가"
```

---

## Task 5: 뉴스탭 ⟨뉴스 | 토론⟩ 세그먼트 — UI

**Files:**
- Create: `src/components/news/DiscussionList.tsx`
- Modify: `src/app/news/page.tsx`

**Interfaces:**
- Consumes: Task 4의 `GET /api/comments?page=` 응답 `{ comments: DiscussionComment[]; viewerIsAdmin }`, `POST /api/comments/[id]/like`(Task 2).

- [ ] **Step 1: 토론뷰 컴포넌트 작성**

Create `src/components/news/DiscussionList.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { getJson, postJson } from "@/lib/api/client";

interface DiscussionComment {
  id: number;
  nickname: string;
  content: string;
  createdAt: string;
  mine: boolean;
  likeCount: number;
  likedByMe: boolean;
  stockCode: string;
  stockName: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  });
}

// 토론 세그먼트: 전 종목 댓글을 시간순으로 모아 보는 읽기 전용 뷰.
// 작성은 각 종목 상세에서만 — 여기선 읽기 + 엄지업만 가능하다.
export function DiscussionList() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["discussion", 1],
    queryFn: () =>
      getJson<{ comments: DiscussionComment[]; viewerIsAdmin: boolean }>(
        "/api/comments?page=1"
      ),
    refetchInterval: 15_000,
  });

  async function toggleLike(c: DiscussionComment) {
    try {
      await postJson(`/api/comments/${c.id}/like`);
      queryClient.invalidateQueries({ queryKey: ["discussion", 1] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "반응에 실패했습니다.");
    }
  }

  if (data && data.comments.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        아직 올라온 토론이 없습니다
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {data?.comments.map((c) => (
        <article
          key={c.id}
          className="rounded-xl border border-foreground/[0.14] bg-card px-4 py-3 shadow-sm"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{c.nickname}</span>
            <span>·</span>
            <span>{relativeTime(c.createdAt)}</span>
            <Link href={`/stocks/${c.stockCode}`} className="ml-auto">
              <Badge className="cursor-pointer bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground">
                {c.stockName}
              </Badge>
            </Link>
          </div>
          <p className="mt-1 break-words text-sm">{c.content}</p>
          <button
            onClick={() => toggleLike(c)}
            aria-label={c.likedByMe ? "엄지업 취소" : "엄지업"}
            className={`mt-1.5 inline-flex items-center gap-1 text-xs transition-colors ${
              c.likedByMe
                ? "text-primary-accent"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ThumbsUp className={`size-3.5 ${c.likedByMe ? "fill-current" : ""}`} />
            {c.likeCount > 0 && <span>{c.likeCount}</span>}
          </button>
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 뉴스 페이지에 세그먼트 토글 추가**

Modify `src/app/news/page.tsx` — 상단 임포트에 추가:

```ts
import { DiscussionList } from "@/components/news/DiscussionList";
```

`NewsPage` 컴포넌트 본문에서 `filter` state 아래에 세그먼트 state 추가:

```ts
  const [tab, setTab] = useState<"news" | "discussion">("news");
```

그리고 sticky 헤더 `<div className="sticky top-14 ...">` **바로 안쪽 맨 위**(종목 필터 `<div className="-mx-4 px-4">`보다 위)에 세그먼트 토글을 삽입:

```tsx
        {/* ⟨뉴스 | 토론⟩ 세그먼트 — 같은 뉴스탭 안에서 피드/토론 전환 */}
        <div className="mb-2 flex gap-1 rounded-lg bg-muted p-0.5">
          <SegmentButton active={tab === "news"} onClick={() => setTab("news")}>
            뉴스
          </SegmentButton>
          <SegmentButton
            active={tab === "discussion"}
            onClick={() => setTab("discussion")}
          >
            토론
          </SegmentButton>
        </div>
```

- [ ] **Step 3: 종목 필터·피드는 뉴스 탭에서만, 토론 탭이면 DiscussionList 렌더**

Modify `src/app/news/page.tsx` — 종목 필터 바(`<div className="-mx-4 px-4">...`)를 `{tab === "news" && ( ... )}`로 감싼다(토론 탭에서는 종목 필터 숨김). 그리고 sticky 헤더를 닫는 `</div>` 다음의 피드 블록(`<div className="mt-4 flex flex-col gap-3">...</div>`)과 하단 안내 `<p>`를 다음으로 교체:

```tsx
      {tab === "news" ? (
        <>
          {/* 피드 — 인스타식 개별 카드 */}
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: pages }, (_, i) => (
              <NewsList
                key={i}
                stock={filter ?? undefined}
                page={i + 1}
                isLast={i + 1 === pages}
                onMore={() => setPages((p) => p + 1)}
              />
            ))}
          </div>
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            정식 뉴스도 가끔 틀리고, 찌라시는 절반만 믿으세요
          </p>
        </>
      ) : (
        <div className="mt-4">
          <DiscussionList />
        </div>
      )}
```

- [ ] **Step 4: `SegmentButton` 헬퍼 컴포넌트 추가**

Modify `src/app/news/page.tsx` — 파일 하단 `FilterChip` 함수 아래에 추가:

```tsx
function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 5: 빌드·린트 통과 확인**

Run: `npm run build && npm run lint`
Expected: 에러 없이 성공.

- [ ] **Step 6: 실앱 verify (verify 스킬)**

verify 스킬로 `/news` 진입 → 상단 ⟨뉴스\|토론⟩ 토글 확인 → "토론" 탭 전환 시 전 종목 댓글이 시간순으로 뜨고, 종목 태그 칩 클릭 시 해당 종목 상세로 이동, 엄지업 동작 확인. "뉴스" 탭이면 기존 피드+종목 필터 정상.
Expected: 세그먼트 전환·태그 이동·엄지업 정상.

- [ ] **Step 7: 커밋**

```bash
git add src/components/news/DiscussionList.tsx src/app/news/page.tsx
git commit -m "feat: 뉴스탭 뉴스·토론 세그먼트 및 토론뷰 추가"
```

---

## Task 6: 뉴스 카드 반응 — 서비스 + API

**Files:**
- Modify: `src/services/newsService.ts`
- Modify: `src/app/api/news/route.ts`
- Create: `src/app/api/news/[id]/reaction/route.ts`

**Interfaces:**
- Consumes: Task 1의 `news_reactions`, 기존 `NewsItem`(`@/types/domain`).
- Produces:
  - `interface NewsFeedItem extends NewsItem { upCount: number; downCount: number; myReaction: "up" | "down" | null }` — Task 7 UI가 소비.
  - `NewsPage.items` 타입이 `NewsFeedItem[]`로 변경.
  - `getNewsFeed(filter, page, viewerId)` — `viewerId: number | null` 3번째 인자 추가.
  - `toggleNewsReaction(userId, newsId, kind): Promise<{ myReaction: "up"|"down"|null; upCount: number; downCount: number }>`.

- [ ] **Step 1: `NewsFeedItem` 타입 + 집계 헬퍼 추가**

Modify `src/services/newsService.ts` — `NewsPage` 인터페이스 위/아래를 다음처럼 정리한다. `NewsPage`를 수정하고 헬퍼를 추가:

```ts
export type NewsReactionKind = "up" | "down";

export interface NewsFeedItem extends NewsItem {
  upCount: number;
  downCount: number;
  myReaction: NewsReactionKind | null;
}

export interface NewsPage {
  items: NewsFeedItem[];
  page: number;
  hasMore: boolean;
}
```

그리고 `toNewsItem` 아래에 반응 집계 헬퍼 추가:

```ts
// 뉴스 id 목록의 up/down 카운트 + 뷰어 본인 반응을 한 번에 집계한다.
async function reactionSummary(
  newsIds: number[],
  viewerId: number | null
): Promise<Map<number, { up: number; down: number; mine: NewsReactionKind | null }>> {
  const summary = new Map<
    number,
    { up: number; down: number; mine: NewsReactionKind | null }
  >();
  if (newsIds.length === 0) return summary;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("news_reactions")
    .select("news_id, user_id, kind")
    .in("news_id", newsIds);
  if (error) throw error;
  for (const row of data) {
    const entry = summary.get(row.news_id) ?? { up: 0, down: 0, mine: null };
    if (row.kind === "up") entry.up += 1;
    else entry.down += 1;
    if (viewerId !== null && row.user_id === viewerId) {
      entry.mine = row.kind as NewsReactionKind;
    }
    summary.set(row.news_id, entry);
  }
  return summary;
}

// NewsItem 배열에 반응 집계를 입혀 NewsFeedItem 배열로 만든다.
async function withReactions(
  items: NewsItem[],
  viewerId: number | null
): Promise<NewsFeedItem[]> {
  const summary = await reactionSummary(
    items.map((n) => n.id),
    viewerId
  );
  return items.map((n) => {
    const r = summary.get(n.id);
    return {
      ...n,
      upCount: r?.up ?? 0,
      downCount: r?.down ?? 0,
      myReaction: r?.mine ?? null,
    };
  });
}
```

- [ ] **Step 2: `getNewsFeed`·`getOutletFeed`에 viewerId + 반응 입히기**

Modify `src/services/newsService.ts`:

`getNewsFeed` 시그니처와 반환을 수정:

```ts
export async function getNewsFeed(
  filter: NewsFeedFilter,
  page: number,
  viewerId: number | null
): Promise<NewsPage> {
  if (filter.outletSlug) {
    return getOutletFeed(filter.outletSlug, page, viewerId);
  }
```

동일 함수 끝부분의 `const items = ...; return { items, page, hasMore };`를:

```ts
  const hasMore = data.length > PAGE_SIZE;
  const base = (data as NewsRow[]).slice(0, PAGE_SIZE).map(toNewsItem);
  const items = await withReactions(base, viewerId);

  return { items, page, hasMore };
```

`getOutletFeed`도 시그니처·반환 수정:

```ts
async function getOutletFeed(
  outletSlug: string,
  page: number,
  viewerId: number | null
): Promise<NewsPage> {
  const index = outletIndexBySlug(outletSlug);
  if (index < 0) return { items: [], page, hasMore: false };
```

그리고 `const items = mine.slice(...).map(toNewsItem); return { items, page, hasMore: ... };`를:

```ts
  const from = (page - 1) * PAGE_SIZE;
  const base = mine.slice(from, from + PAGE_SIZE).map(toNewsItem);
  const items = await withReactions(base, viewerId);

  return { items, page, hasMore: mine.length > from + PAGE_SIZE };
```

- [ ] **Step 3: `toggleNewsReaction` 추가**

Modify `src/services/newsService.ts` — 파일 끝에 추가:

```ts
// 뉴스 반응 토글: 같은 방향 재클릭이면 취소, 다른 방향이면 전환, 없으면 추가.
// 새 본인 반응과 up/down 카운트를 돌려준다.
export async function toggleNewsReaction(
  userId: number,
  newsId: number,
  kind: NewsReactionKind
): Promise<{ myReaction: NewsReactionKind | null; upCount: number; downCount: number }> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: selError } = await supabase
    .from("news_reactions")
    .select("kind")
    .eq("news_id", newsId)
    .eq("user_id", userId)
    .maybeSingle();
  if (selError) throw selError;

  let myReaction: NewsReactionKind | null;
  if (existing && existing.kind === kind) {
    const { error } = await supabase
      .from("news_reactions")
      .delete()
      .eq("news_id", newsId)
      .eq("user_id", userId);
    if (error) throw error;
    myReaction = null;
  } else {
    // 없는 뉴스면 FK 위반 → NOT_FOUND
    const { error } = await supabase
      .from("news_reactions")
      .upsert(
        { news_id: newsId, user_id: userId, kind },
        { onConflict: "news_id,user_id" }
      );
    if (error) {
      throw new ApiException("NOT_FOUND", "없는 뉴스입니다.");
    }
    myReaction = kind;
  }

  const { data: rows, error: countError } = await supabase
    .from("news_reactions")
    .select("kind")
    .eq("news_id", newsId);
  if (countError) throw countError;
  const upCount = rows.filter((r) => r.kind === "up").length;
  const downCount = rows.filter((r) => r.kind === "down").length;

  return { myReaction, upCount, downCount };
}
```

그리고 파일 상단 임포트에 `ApiException` 추가(없으면):

```ts
import { ApiException } from "@/lib/api/response";
```

- [ ] **Step 4: `/api/news` GET에 viewerId 전달**

Modify `src/app/api/news/route.ts` — 세션을 읽어 3번째 인자로 넘긴다:

```ts
import { apiOk, handleApiError } from "@/lib/api/response";
import { getSession } from "@/lib/auth/session";
import { getNewsFeed } from "@/services/newsService";

// 뉴스 피드 (공개 API) — 로그인 시 본인 반응(myReaction) 표시
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const stock = params.get("stock");
    const outlet = params.get("outlet");
    const pageParam = Number(params.get("page") ?? "1");
    const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    const session = await getSession();
    return apiOk(
      await getNewsFeed(
        { stockCode: stock ? stock.toUpperCase() : null, outletSlug: outlet },
        page,
        session?.uid ?? null
      )
    );
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 5: 반응 토글 API route 작성**

Create `src/app/api/news/[id]/reaction/route.ts`:

```ts
import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { toggleNewsReaction } from "@/services/newsService";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({ kind: z.enum(["up", "down"]) });

// 뉴스 카드 엄지업/엄지다운 토글 (로그인 필요)
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const newsId = Number(id);
    if (!Number.isInteger(newsId) || newsId <= 0) {
      return apiError("VALIDATION", "잘못된 뉴스 id입니다.");
    }
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "잘못된 반응 종류입니다.");
    }
    return apiOk(await toggleNewsReaction(user.id, newsId, parsed.data.kind));
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 6: 빌드·린트 통과 확인**

Run: `npm run build && npm run lint`
Expected: 에러 없이 성공. (`getNewsFeed` 호출처가 route 1곳뿐이라 시그니처 변경 누락 없음 — 빌드가 보증.)

- [ ] **Step 7: API 응답 확인 (curl)**

dev 서버 실행 중 가정. Run:
```bash
curl -s "localhost:3000/api/news?page=1" | head -c 500
```
Expected: 각 뉴스 항목에 `upCount`,`downCount`,`myReaction` 필드 포함(값 0/0/null 기본).

- [ ] **Step 8: 커밋**

```bash
git add src/services/newsService.ts src/app/api/news/route.ts "src/app/api/news/[id]/reaction/route.ts"
git commit -m "feat: 뉴스 카드 엄지업/엄지다운 반응 서비스·API 추가"
```

---

## Task 7: 뉴스 카드 반응 — UI (NewsList)

**Files:**
- Modify: `src/components/news/NewsList.tsx`

**Interfaces:**
- Consumes: Task 6의 `NewsFeedItem`(upCount/downCount/myReaction), `POST /api/news/[id]/reaction` 응답.

- [ ] **Step 1: 클라이언트 타입·임포트 반영**

Modify `src/components/news/NewsList.tsx` — 임포트에 반응 아이콘·훅·toast·postJson 추가:

```ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { getJson, postJson } from "@/lib/api/client";
```

그리고 `NewsPageDto`가 참조하는 아이템 타입을 반응 포함 타입으로 바꾼다. 파일 상단에 로컬 타입 선언 추가하고 `NewsPageDto.items`를 교체:

```ts
type NewsReactionKind = "up" | "down";

interface NewsFeedItem extends NewsItem {
  upCount: number;
  downCount: number;
  myReaction: NewsReactionKind | null;
}

export interface NewsPageDto {
  items: NewsFeedItem[];
  page: number;
  hasMore: boolean;
}
```

(`authorOf(n: NewsItem)` 등 기존 시그니처는 `NewsFeedItem`이 `NewsItem`을 확장하므로 그대로 호환된다. `NewsPageDto`를 함께 import하는 `NewsHighlight.tsx`도 `.date`/`.grade` 등 `NewsItem` 필드만 읽으므로 무영향 — 반응 필드는 추가분일 뿐이다.)

- [ ] **Step 2: `queryClient` + 토글 핸들러 추가**

Modify `src/components/news/NewsList.tsx` — `NewsList` 컴포넌트 함수 본문 맨 위(useQuery 위)에 추가:

```ts
  const queryClient = useQueryClient();
```

그리고 useQuery 블록 아래에 토글 핸들러 추가:

```ts
  async function react(n: NewsFeedItem, kind: NewsReactionKind) {
    try {
      await postJson(`/api/news/${n.id}/reaction`, { kind });
      queryClient.invalidateQueries({ queryKey: ["news"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "반응에 실패했습니다.");
    }
  }
```

(`queryKey: ["news"]` prefix 무효화 — 모든 뉴스 페이지 쿼리를 갱신.)

- [ ] **Step 3: 카드 푸터에 반응 버튼 렌더**

Modify `src/components/news/NewsList.tsx` — 캐시태그 블록(`{!compact && !stockAccount && n.stockCode && ...}`) **아래**, `</div>`(`min-w-0 flex-1` 닫힘) 직전에 반응 바를 추가한다. compact 뷰(카드 내부 요약)에서는 숨긴다:

```tsx
              {/* 반응 — 전 등급 엄지업/엄지다운 (아이콘만, 라벨 없음) */}
              {!compact && (
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={() => react(n, "up")}
                    aria-label={n.myReaction === "up" ? "엄지업 취소" : "엄지업"}
                    className={cn(
                      "inline-flex items-center gap-1 text-xs transition-colors",
                      n.myReaction === "up"
                        ? "text-primary-accent"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ThumbsUp
                      className={cn("size-3.5", n.myReaction === "up" && "fill-current")}
                    />
                    {n.upCount > 0 && <span>{n.upCount}</span>}
                  </button>
                  <button
                    onClick={() => react(n, "down")}
                    aria-label={n.myReaction === "down" ? "엄지다운 취소" : "엄지다운"}
                    className={cn(
                      "inline-flex items-center gap-1 text-xs transition-colors",
                      n.myReaction === "down"
                        ? "text-destructive"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ThumbsDown
                      className={cn("size-3.5", n.myReaction === "down" && "fill-current")}
                    />
                    {n.downCount > 0 && <span>{n.downCount}</span>}
                  </button>
                </div>
              )}
```

- [ ] **Step 4: 빌드·린트 통과 확인**

Run: `npm run build && npm run lint`
Expected: 에러 없이 성공.

- [ ] **Step 5: 실앱 verify (verify 스킬)**

verify 스킬로 `/news` 뉴스 탭 → 임의 카드에서 엄지업 클릭 시 카운트 1·아이콘 채워짐, 엄지다운 클릭 시 방향 전환(up 0/down 1), 같은 방향 재클릭 시 취소(0) 확인. 공시·정식·찌라시 전 등급에서 동작.
Expected: 전 등급 반응·토글·전환 정상, 새로고침 후 상태 유지, 미로그인 시 로그인 유도.

- [ ] **Step 6: 커밋**

```bash
git add src/components/news/NewsList.tsx
git commit -m "feat: 뉴스 카드 엄지업/엄지다운 반응 UI 추가"
```

---

## 배포 · 마무리 (실행 후)

- [ ] **리허설 재생성:** 신규 테이블은 cascade로 `reset_rehearsal_data`가 자동 정리하므로 reset 함수 수정은 불필요. 단 로컬 검증 후 [[rehearsal-reset-before-open]] 절차대로 리허설 데이터 재생성.
- [ ] **prod push:** 마이그레이션 `20260718070000_social_reactions.sql`를 [[sector-overhaul-deploy-lessons]] 절차(코드 배포 먼저 → 마이그레이션 prod push)로 반영.
- [ ] **PR:** `feat/immersion-features` 브랜치에서 소셜확장 3종 PR 생성.
- [ ] **메모리 갱신:** [[immersion-benchmark-research]]에 소셜확장 완료·PR 번호 기록, "다음: 배지→온보딩" 갱신.

## 다루지 않음 (이번 범위 밖)

- **스티커**(§2-4) — 이미지 자산 준비 후 별도 스펙·계획.
- **성취 배지·타이틀**(§③), **경량 온보딩**(§④) — 후속 순서.
- 반응 페이지네이션·"더 보기"(토론뷰) — 초기 볼륨 작아 1페이지 30건으로 충분(YAGNI). 필요 시 후속.

## 자기 검토 메모 (계획 작성자)

- **스펙 커버리지:** §2-1 댓글 엄지업(Task 2·3) / §2-2 토론 세그먼트(Task 4·5) / §2-3 뉴스 반응 전 등급 엄지업·다운(Task 6·7) — 3종 전부 태스크 존재. §2-4 스티커는 명시적 제외.
- **타입 일관성:** `StockComment.likeCount/likedByMe`(Task 2)를 Task 3·4가 그대로 소비. `NewsFeedItem`(Task 6)을 Task 7이 미러. `toggleCommentLike`/`toggleNewsReaction` 반환형이 route·UI와 일치.
- **집계 방식:** 반응 행 소량이라 JS 합산(별도 인덱스로 조회 빠름). 스케일 커지면 뷰/RPC로 후속 최적화 여지.

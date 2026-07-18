# 댓글 대댓글(중첩 스레드) + 루머 "미확인" 배지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 종목 토론방 댓글에 2단계 평톤 대댓글(삭제 시 묘비 보존)을 추가하고, 찌라시 뉴스에 "미확인" 배지를 붙인다.

**Architecture:** `stock_comments`에 자기참조 `parent_id` + 소프트삭제 `deleted_at`만 추가한다. 2단계 제한·묘비 삭제·중첩 조립은 전부 서비스 레이어(`commentService.ts`)에서 처리하고, PostgREST 임베드 대신 앱에서 조립한다(N+1 배치 유지). UI는 최상위 댓글 아래 "답글 N개 보기" 토글 + 답글 입력창을 얹는다.

**Tech Stack:** Next.js 16(App Router) · React 19 · TypeScript strict · Supabase(Postgres+RLS, service-role만) · TanStack Query v5 · Tailwind v4 · shadcn/ui · lucide-react(개별 임포트).

## Global Constraints

- 검증 루프 = `npm run build` + `npx eslint src`(워크트리는 `npm run lint` 대신 스코프 지정). **단위 테스트 프레임워크 없음** — UI는 verify 스킬(agent-browser) 실앱 검증, DB는 `npx supabase db reset` + psql.
- TypeScript strict — `any` 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트.
- 임포트 개별(lucide-react 포함), 경로 alias `@/*` → `./src/*`.
- 돈·틱 계산 없음(순수 소셜 기능) — 서버 신뢰 규칙 대상 아님.
- UI 문구에 **이모지 금지**. 커밋 메시지·주석 한국어.
- 커밋 형식 `type: 한국어 설명`. main 직접 커밋 금지 — 현재 브랜치 `worktree-feat+ui-tweaks`에서 작업.
- Supabase 접근은 `getSupabaseAdmin()`(service-role)만. `users` 임베드는 FK 명시 필수: `users!stock_comments_user_id_fkey(nickname)`(PGRST201 회피).
- 마이그레이션 파일명 규칙: `supabase/migrations/YYYYMMDDHHMMSS_설명.sql`.

---

### Task 1: DB 마이그레이션 — parent_id + deleted_at + 제약 완화

**Files:**
- Create: `supabase/migrations/20260719000000_comment_threads.sql`

**Interfaces:**
- Consumes: 기존 `stock_comments` 테이블(20260713100000), `stock_comments_has_body` 제약(20260718080000).
- Produces: `stock_comments.parent_id bigint null`(self-FK, cascade), `stock_comments.deleted_at timestamptz null`, 인덱스 `stock_comments_parent_idx`, 완화된 `stock_comments_has_body` 제약.

- [ ] **Step 1: 마이그레이션 작성**

Create `supabase/migrations/20260719000000_comment_threads.sql`:

```sql
-- 대댓글(중첩 스레드) + 묘비 삭제 (UI 개선 Phase D)
--
-- parent_id 자기참조로 2단계 스레드를 만든다. 2단계 제한(답글에 답글 금지)은
-- 서비스 레이어에서 강제한다. 답글이 달린 부모를 삭제하면 하드삭제 대신 deleted_at을
-- 세팅해 "삭제된 댓글입니다" 묘비로 남기고 답글을 보존한다.

-- 부모 하드삭제 시 답글도 함께 정리되도록 자기참조 cascade
alter table stock_comments
  add column parent_id bigint null references stock_comments (id) on delete cascade;

-- 소프트 삭제(묘비) 마커
alter table stock_comments
  add column deleted_at timestamptz null;

-- 부모별 답글을 created_at asc(대화 흐름)로 조회하기 위한 인덱스
create index stock_comments_parent_idx on stock_comments (parent_id, created_at asc);

-- 묘비 행은 content·sticker 둘 다 null이 되므로 has_body 제약을 완화한다
alter table stock_comments drop constraint if exists stock_comments_has_body;
alter table stock_comments add constraint stock_comments_has_body
  check (deleted_at is not null or content is not null or sticker_id is not null);
```

- [ ] **Step 2: 로컬 DB에 적용 확인**

Run: `npx supabase db reset`
Expected: 마이그레이션이 에러 없이 전부 적용되고 seed까지 완료("Finished supabase db reset").

- [ ] **Step 3: 스키마 반영 확인**

Run:
```bash
docker exec -i supabase_db_naraka-stock psql -U postgres -d postgres -c "\d stock_comments" 2>/dev/null || npx supabase db reset >/dev/null && echo "reset ok"
```
Expected: `parent_id`, `deleted_at` 컬럼과 `stock_comments_parent_idx` 인덱스, self-FK가 목록에 보인다. (컨테이너명이 다르면 `docker ps`로 `_db` 컨테이너 확인)

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260719000000_comment_threads.sql
git commit -m "feat: 댓글 대댓글용 parent_id·deleted_at 마이그레이션"
```

---

### Task 2: 서비스 레이어 — 중첩 조립 · 2단계 검증 · 묘비 삭제

**Files:**
- Modify: `src/services/commentService.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin()`, `ApiException`, `likeSummary`(기존), `representativeBadgesFor`(기존), `assertValidStickerId`.
- Produces:
  - `interface StockComment` 확장 — `content: string | null`, 추가 `deleted: boolean`, `replies?: StockComment[]`.
  - `interface DiscussionComment extends StockComment` — 추가 `replyCount: number`.
  - `listComments(stockCode: string, viewerId: number | null): Promise<StockComment[]>` — 최상위(최신순) 각 항목에 `replies`(오래된순) 채움.
  - `createComment(userId: number, stockCode: string, content: string | null, stickerId: string | null, parentId: number | null): Promise<void>` — **시그니처에 parentId 추가**.
  - `deleteComment(userId, commentId)` / `adminDeleteComment(commentId)` — 묘비/하드 분기.
  - `listAllComments(viewerId, page)` — 최상위만 + `replyCount`.

- [ ] **Step 1: StockComment 인터페이스 확장 + row 매퍼 헬퍼 추출**

`src/services/commentService.ts`의 `StockComment` 인터페이스를 교체하고, 조회 컬럼 상수와 매퍼 헬퍼를 파일 상단(인터페이스 아래)에 추가한다:

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
  deleted: boolean; // 묘비(deleted_at != null) 여부
  replies?: StockComment[]; // 최상위 댓글에만 채워짐
}

// 조회 컬럼 — 목록/조립에서 공용 (users는 FK 명시로 PGRST201 회피)
const COMMENT_COLUMNS =
  "id, user_id, content, created_at, sticker_id, parent_id, deleted_at, users!stock_comments_user_id_fkey(nickname)";

// 조회 row 한 건을 StockComment로 변환 (부모·답글 공용)
function toComment(
  row: {
    id: number;
    user_id: number;
    content: string | null;
    created_at: string;
    sticker_id: string | null;
    deleted_at: string | null;
    users: unknown;
  },
  likes: Map<number, { count: number; mine: boolean }>,
  badges: Map<number, WeeklyBadge | null>,
  viewerId: number | null
): StockComment {
  const like = likes.get(row.id);
  const deleted = row.deleted_at !== null;
  return {
    id: row.id,
    nickname: deleted
      ? ""
      : (row.users as { nickname: string } | null)?.nickname ?? "(탈퇴)",
    content: deleted ? null : row.content,
    createdAt: row.created_at,
    mine: !deleted && viewerId !== null && row.user_id === viewerId,
    likeCount: deleted ? 0 : like?.count ?? 0,
    likedByMe: !deleted && (like?.mine ?? false),
    representativeBadge: deleted ? null : badges.get(row.user_id) ?? null,
    stickerId: deleted ? null : row.sticker_id ?? null,
    deleted,
  };
}
```

- [ ] **Step 2: `listComments`를 두 쿼리 + 중첩 조립으로 교체**

기존 `listComments` 함수 전체를 아래로 교체한다:

```ts
export async function listComments(
  stockCode: string,
  viewerId: number | null
): Promise<StockComment[]> {
  const supabase = getSupabaseAdmin();

  // 1) 최상위 댓글 최신순 PAGE_SIZE개
  const { data: parents, error: pErr } = await supabase
    .from("stock_comments")
    .select(COMMENT_COLUMNS)
    .eq("stock_code", stockCode)
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (pErr) throw pErr;

  // 2) 그 부모들의 답글 전체 (대화 흐름 = 오래된순)
  const parentIds = parents.map((row) => row.id);
  let replies: typeof parents = [];
  if (parentIds.length > 0) {
    const { data: replyRows, error: rErr } = await supabase
      .from("stock_comments")
      .select(COMMENT_COLUMNS)
      .in("parent_id", parentIds)
      .order("created_at", { ascending: true });
    if (rErr) throw rErr;
    replies = replyRows;
  }

  // 좋아요·배지 집계는 부모+답글 전체 id로 한 번에 (N+1 방지)
  const allRows = [...parents, ...replies];
  const likes = await likeSummary(
    allRows.map((row) => row.id),
    viewerId
  );
  const badges = await representativeBadgesFor(allRows.map((row) => row.user_id));

  // 부모별 답글 묶기
  const repliesByParent = new Map<number, StockComment[]>();
  for (const row of replies) {
    const mapped = toComment(row, likes, badges, viewerId);
    const list = repliesByParent.get(row.parent_id as number) ?? [];
    list.push(mapped);
    repliesByParent.set(row.parent_id as number, list);
  }

  return parents.map((row) => ({
    ...toComment(row, likes, badges, viewerId),
    replies: repliesByParent.get(row.id) ?? [],
  }));
}
```

> 참고: `select(COMMENT_COLUMNS)` 결과 타입에 `parent_id`가 포함되므로 `row.parent_id as number` 캐스팅이 필요하다(답글은 parent_id가 반드시 존재).

- [ ] **Step 3: `createComment`에 parentId 추가 + 2단계 검증**

`createComment` 시그니처와 본문을 교체한다(도배 제한 블록·stock 확인은 유지, insert에 parent_id 추가, 2단계 검증 삽입):

```ts
export async function createComment(
  userId: number,
  stockCode: string,
  content: string | null,
  stickerId: string | null,
  parentId: number | null
): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (!content && !stickerId) {
    throw new ApiException("VALIDATION", "내용이나 스티커를 입력해주세요.");
  }

  const { data: stock, error: stockError } = await supabase
    .from("stocks")
    .select("code")
    .eq("code", stockCode)
    .maybeSingle();
  if (stockError) throw stockError;
  if (!stock) {
    throw new ApiException("NOT_FOUND", "없는 종목입니다.");
  }

  // 답글이면 부모 검증: 존재·같은 종목·최상위(2단계 제한)·묘비 아님
  if (parentId !== null) {
    const { data: parent, error: parentError } = await supabase
      .from("stock_comments")
      .select("id, stock_code, parent_id, deleted_at")
      .eq("id", parentId)
      .maybeSingle();
    if (parentError) throw parentError;
    if (!parent || parent.stock_code !== stockCode) {
      throw new ApiException("NOT_FOUND", "없는 댓글입니다.");
    }
    if (parent.parent_id !== null) {
      throw new ApiException("VALIDATION", "답글에는 답글을 달 수 없습니다.");
    }
    if (parent.deleted_at !== null) {
      throw new ApiException("VALIDATION", "삭제된 댓글에는 답글을 달 수 없습니다.");
    }
  }

  if (stickerId) await assertValidStickerId(stickerId);

  // 도배 방지: 최근 1분 작성 수 제한 (부모·답글 공통)
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error: countError } = await supabase
    .from("stock_comments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (countError) throw countError;
  if ((count ?? 0) >= BURST_LIMIT) {
    throw new ApiException("VALIDATION", "너무 빨라요! 잠시 후 다시 남겨주세요.");
  }

  const { error } = await supabase.from("stock_comments").insert({
    user_id: userId,
    stock_code: stockCode,
    content,
    sticker_id: stickerId,
    parent_id: parentId,
  });
  if (error) throw error;
}
```

- [ ] **Step 4: 삭제를 묘비/하드 분기로 교체**

기존 `updateComment`는 `deleted_at is null` 가드만 추가하고, `deleteComment`·`adminDeleteComment`를 공용 헬퍼로 교체한다:

```ts
// 본인 댓글만 수정 (묘비는 수정 불가)
export async function updateComment(
  userId: number,
  commentId: number,
  content: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stock_comments")
    .update({ content })
    .eq("id", commentId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new ApiException("NOT_FOUND", "수정할 수 없는 댓글입니다.");
  }
}

// 삭제 공용: 답글이 있으면 묘비(소프트), 없으면 하드 삭제.
// restrictUserId가 있으면 본인 것만(비어드민), null이면 무제한(어드민).
async function performDelete(
  commentId: number,
  restrictUserId: number | null
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { count, error: countError } = await supabase
    .from("stock_comments")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", commentId);
  if (countError) throw countError;
  const hasReplies = (count ?? 0) > 0;

  let query;
  if (hasReplies) {
    // 묘비: 답글 보존, 본문·스티커 비우고 deleted_at 세팅
    query = supabase
      .from("stock_comments")
      .update({ deleted_at: new Date().toISOString(), content: null, sticker_id: null })
      .eq("id", commentId)
      .is("deleted_at", null);
  } else {
    query = supabase.from("stock_comments").delete().eq("id", commentId);
  }
  if (restrictUserId !== null) query = query.eq("user_id", restrictUserId);

  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new ApiException("NOT_FOUND", "삭제할 수 없는 댓글입니다.");
  }
}

export async function deleteComment(userId: number, commentId: number): Promise<void> {
  return performDelete(commentId, userId);
}

export async function adminDeleteComment(commentId: number): Promise<void> {
  return performDelete(commentId, null);
}
```

- [ ] **Step 5: `listAllComments`를 최상위만 + replyCount로 교체**

`DiscussionComment` 인터페이스와 `listAllComments`를 교체한다:

```ts
export interface DiscussionComment extends StockComment {
  stockCode: string;
  stockName: string;
  replyCount: number;
}

export async function listAllComments(
  viewerId: number | null,
  page: number
): Promise<DiscussionComment[]> {
  const supabase = getSupabaseAdmin();
  const from = (page - 1) * PAGE_SIZE;
  const { data, error } = await supabase
    .from("stock_comments")
    .select(
      "id, user_id, stock_code, content, created_at, sticker_id, parent_id, deleted_at, users!stock_comments_user_id_fkey(nickname), stocks(name)"
    )
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;

  const ids = data.map((row) => row.id);
  const likes = await likeSummary(ids, viewerId);
  const badges = await representativeBadgesFor(data.map((row) => row.user_id));

  // 답글 개수 집계: 이 페이지 부모들의 자식을 한 번에 조회해 JS 합산
  const replyCounts = new Map<number, number>();
  if (ids.length > 0) {
    const { data: childRows, error: childError } = await supabase
      .from("stock_comments")
      .select("parent_id")
      .in("parent_id", ids);
    if (childError) throw childError;
    for (const c of childRows) {
      const pid = c.parent_id as number;
      replyCounts.set(pid, (replyCounts.get(pid) ?? 0) + 1);
    }
  }

  return data.map((row) => ({
    ...toComment(row, likes, badges, viewerId),
    stockCode: row.stock_code,
    stockName: (row.stocks as { name: string } | null)?.name ?? row.stock_code,
    replyCount: replyCounts.get(row.id) ?? 0,
  }));
}
```

- [ ] **Step 6: 빌드 + 린트**

Run: `npm run build && npx eslint src/services/commentService.ts`
Expected: 타입 에러·린트 에러 없이 통과. (`row.parent_id`/`row.stocks` 캐스팅 관련 에러 시 위 캐스팅 확인)

- [ ] **Step 7: 커밋**

```bash
git add src/services/commentService.ts
git commit -m "feat: 댓글 중첩 조립·2단계 검증·묘비 삭제 서비스 로직"
```

---

### Task 3: API 라우트 — parentId 수용

**Files:**
- Modify: `src/app/api/stocks/[code]/comments/route.ts`

**Interfaces:**
- Consumes: `createComment(userId, stockCode, content, stickerId, parentId)`(Task 2 시그니처).
- Produces: POST body에 `parentId?: number` 허용. GET/PATCH/DELETE 불변.

- [ ] **Step 1: createSchema에 parentId 추가**

`createSchema` 정의를 교체한다:

```ts
const createSchema = z
  .object({
    content: contentField.optional(),
    stickerId: stickerIdField.optional(),
    parentId: z.number().int().positive().optional(),
  })
  .refine((d) => Boolean(d.content) || Boolean(d.stickerId), {
    message: "내용이나 스티커를 입력해주세요",
  });
```

- [ ] **Step 2: POST 핸들러에서 parentId 전달**

POST 핸들러의 `createComment(...)` 호출을 교체한다:

```ts
    await createComment(
      user.id,
      code.toUpperCase(),
      parsed.data.content ?? null,
      parsed.data.stickerId ?? null,
      parsed.data.parentId ?? null
    );
```

- [ ] **Step 3: 빌드 + 린트**

Run: `npm run build && npx eslint "src/app/api/stocks/[code]/comments/route.ts"`
Expected: 통과.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/api/stocks/[code]/comments/route.ts"
git commit -m "feat: 댓글 API에 parentId 파라미터 추가"
```

---

### Task 4: 종목 토론방 UI — 답글 스레드 · 묘비 렌더

**Files:**
- Modify: `src/components/trade/StockComments.tsx`

**Interfaces:**
- Consumes: `/api/stocks/[code]/comments` GET가 반환하는 `StockComment`(with `replies`, `deleted`), POST가 받는 `parentId`.
- Produces: 없음(리프 컴포넌트).

- [ ] **Step 1: 컴포넌트 전체 교체**

`src/components/trade/StockComments.tsx` 전체를 아래로 교체한다. 최상위 댓글은 `CommentRow`로, 답글 목록/입력은 인라인으로 렌더하며, 묘비(`deleted`)는 회색 안내문만 표시한다:

```tsx
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, MessageCircle, Pencil, ThumbsUp, X } from "lucide-react";
import { toast } from "sonner";
import { BadgeChip } from "@/components/badges/BadgeChip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson, patchJson, postJson } from "@/lib/api/client";
import { EmptyState } from "@/components/mascot/EmptyState";
import { StickerPicker } from "@/components/trade/StickerPicker";
import { useStickers, type CatalogSticker } from "@/hooks/useStickers";
import { cn } from "@/lib/utils";
import type { WeeklyBadge } from "@/types/domain";

interface StockComment {
  id: number;
  nickname: string;
  content: string | null;
  createdAt: string;
  mine: boolean;
  likeCount: number;
  likedByMe: boolean;
  representativeBadge: WeeklyBadge | null;
  stickerId: string | null;
  deleted: boolean;
  replies?: StockComment[];
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

// 종목 토론방 (토스 벤치마킹): 주가 보면서 밈·찌라시 나누는 실시간 댓글창.
// 10초 폴링으로 다른 손님 댓글이 흘러들어온다. 최상위 댓글 + 2단계 평톤 답글.
export function StockComments({ stockCode }: { stockCode: string }) {
  const queryClient = useQueryClient();
  const { byId } = useStickers();
  const [content, setContent] = useState("");
  const [sticker, setSticker] = useState<CatalogSticker | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ["comments", stockCode],
    queryFn: () =>
      getJson<{ comments: StockComment[]; viewerIsAdmin: boolean }>(
        `/api/stocks/${stockCode}/comments`
      ),
    refetchInterval: 10_000,
  });

  const isAdmin = data?.viewerIsAdmin ?? false;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["comments", stockCode] });
  }

  async function submitTop() {
    const trimmed = content.trim();
    if ((!trimmed && !sticker) || submitting) return;
    setSubmitting(true);
    try {
      await postJson(`/api/stocks/${stockCode}/comments`, {
        content: trimmed || undefined,
        stickerId: sticker?.id,
      });
      setContent("");
      setSticker(null);
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "댓글 작성에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(c: StockComment) {
    setEditingId(c.id);
    setEditContent(c.content ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent("");
  }

  async function saveEdit(id: number) {
    const trimmed = editContent.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await patchJson(`/api/stocks/${stockCode}/comments`, { id, content: trimmed });
      cancelEdit();
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "수정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: StockComment) {
    const message = c.mine
      ? "이 댓글을 삭제할까요?"
      : `'${c.nickname}'님의 댓글을 삭제할까요? (관리자 권한)`;
    if (!window.confirm(message)) return;
    try {
      const res = await fetch(`/api/stocks/${stockCode}/comments?id=${c.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제에 실패했습니다.");
    }
  }

  async function toggleLike(c: StockComment) {
    try {
      await postJson(`/api/comments/${c.id}/like`);
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "반응에 실패했습니다.");
    }
  }

  // 전체 댓글 수(묘비 제외, 부모+답글)
  const total = (data?.comments ?? []).reduce(
    (sum, c) => sum + (c.deleted ? 0 : 1) + (c.replies?.filter((r) => !r.deleted).length ?? 0),
    0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          토론방{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {data ? `${total}개` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CommentComposer
          content={content}
          setContent={setContent}
          sticker={sticker}
          setSticker={setSticker}
          submitting={submitting}
          onSubmit={submitTop}
        />

        <div className="flex flex-col divide-y divide-border/60">
          {data?.comments.length === 0 && (
            <EmptyState
              mascotSize={72}
              className="py-6"
              title="아직 댓글이 없어요."
              description="첫 밈을 남겨보세요."
            />
          )}
          {data?.comments.map((c) => (
            <div key={c.id} className="py-2.5">
              <CommentRow
                comment={c}
                stockCode={stockCode}
                byId={byId}
                isAdmin={isAdmin}
                editingId={editingId}
                editContent={editContent}
                saving={saving}
                onStartEdit={startEdit}
                onCancelEdit={cancelEdit}
                onSaveEdit={saveEdit}
                onEditContentChange={setEditContent}
                onRemove={remove}
                onToggleLike={toggleLike}
                onReplied={invalidate}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// 상단 작성창(최상위 댓글 전용) — 스티커 피커 포함
function CommentComposer({
  content,
  setContent,
  sticker,
  setSticker,
  submitting,
  onSubmit,
}: {
  content: string;
  setContent: (v: string) => void;
  sticker: CatalogSticker | null;
  setSticker: (v: CatalogSticker | null) => void;
  submitting: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {sticker && (
        <div className="flex items-center gap-2 rounded-md border border-border/60 p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sticker.imageUrl} alt={sticker.label} className="size-12 object-contain" />
          <span className="text-xs text-muted-foreground">{sticker.label}</span>
          <button
            type="button"
            onClick={() => setSticker(null)}
            aria-label="스티커 제거"
            className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <StickerPicker onSelect={setSticker} />
        <Input
          placeholder="한마디 남기기 (200자)"
          value={content}
          maxLength={200}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && onSubmit()}
        />
        <Button onClick={onSubmit} disabled={submitting || (!content.trim() && !sticker)}>
          등록
        </Button>
      </div>
    </div>
  );
}

// 최상위 댓글 한 건 + 답글 스레드 토글/입력
function CommentRow({
  comment: c,
  stockCode,
  byId,
  isAdmin,
  editingId,
  editContent,
  saving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditContentChange,
  onRemove,
  onToggleLike,
  onReplied,
}: {
  comment: StockComment;
  stockCode: string;
  byId: Map<string, CatalogSticker>;
  isAdmin: boolean;
  editingId: number | null;
  editContent: string;
  saving: boolean;
  onStartEdit: (c: StockComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onEditContentChange: (v: string) => void;
  onRemove: (c: StockComment) => void;
  onToggleLike: (c: StockComment) => void;
  onReplied: () => void;
}) {
  const [showReplies, setShowReplies] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const replies = c.replies ?? [];

  // 묘비: 작성자·액션 없이 안내문만, 답글은 유지
  if (c.deleted) {
    return (
      <>
        <p className="text-xs italic text-muted-foreground">삭제된 댓글입니다.</p>
        <ReplyThread
          replies={replies}
          showReplies={showReplies}
          setShowReplies={setShowReplies}
          replyOpen={replyOpen}
          setReplyOpen={setReplyOpen}
          parentDeleted
          stockCode={stockCode}
          byId={byId}
          isAdmin={isAdmin}
          editingId={editingId}
          editContent={editContent}
          saving={saving}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
          onEditContentChange={onEditContentChange}
          onRemove={onRemove}
          onToggleLike={onToggleLike}
          onReplied={onReplied}
          parentId={c.id}
          parentNickname={c.nickname}
        />
      </>
    );
  }

  return (
    <>
      <CommentBody
        c={c}
        byId={byId}
        isAdmin={isAdmin}
        editingId={editingId}
        editContent={editContent}
        saving={saving}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onEditContentChange={onEditContentChange}
        onRemove={onRemove}
        onToggleLike={onToggleLike}
        onReply={() => {
          setShowReplies(true);
          setReplyOpen((v) => !v);
        }}
      />
      <ReplyThread
        replies={replies}
        showReplies={showReplies}
        setShowReplies={setShowReplies}
        replyOpen={replyOpen}
        setReplyOpen={setReplyOpen}
        stockCode={stockCode}
        byId={byId}
        isAdmin={isAdmin}
        editingId={editingId}
        editContent={editContent}
        saving={saving}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onEditContentChange={onEditContentChange}
        onRemove={onRemove}
        onToggleLike={onToggleLike}
        onReplied={onReplied}
        parentId={c.id}
        parentNickname={c.nickname}
      />
    </>
  );
}

// 댓글/답글 본문 공용 (묘비 아닌 행). onReply가 있으면 "답글" 버튼 노출(최상위만).
function CommentBody({
  c,
  byId,
  isAdmin,
  editingId,
  editContent,
  saving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditContentChange,
  onRemove,
  onToggleLike,
  onReply,
}: {
  c: StockComment;
  byId: Map<string, CatalogSticker>;
  isAdmin: boolean;
  editingId: number | null;
  editContent: string;
  saving: boolean;
  onStartEdit: (c: StockComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onEditContentChange: (v: string) => void;
  onRemove: (c: StockComment) => void;
  onToggleLike: (c: StockComment) => void;
  onReply?: () => void;
}) {
  const sticker = c.stickerId ? byId.get(c.stickerId) : undefined;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{c.nickname}</span>{" "}
          {c.representativeBadge && <BadgeChip badge={c.representativeBadge} />}{" "}
          · {relativeTime(c.createdAt)}
        </p>
        {editingId === c.id ? (
          <div className="mt-1 flex gap-2">
            <Input
              value={editContent}
              maxLength={200}
              autoFocus
              onChange={(e) => onEditContentChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) onSaveEdit(c.id);
                if (e.key === "Escape") onCancelEdit();
              }}
            />
          </div>
        ) : (
          <>
            {c.content && <p className="mt-0.5 break-words text-sm">{c.content}</p>}
            {sticker && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sticker.imageUrl} alt={sticker.label} className="mt-1 size-24 object-contain" />
            )}
            <div className="mt-1 flex items-center gap-3">
              <button
                onClick={() => onToggleLike(c)}
                aria-label={c.likedByMe ? "엄지업 취소" : "엄지업"}
                className={cn(
                  "inline-flex items-center gap-1 text-xs transition-colors",
                  c.likedByMe
                    ? "text-primary-accent"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ThumbsUp className={cn("size-3.5", c.likedByMe && "fill-current")} />
                {c.likeCount > 0 && <span>{c.likeCount}</span>}
              </button>
              {onReply && (
                <button
                  onClick={onReply}
                  aria-label="답글 달기"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <MessageCircle className="size-3.5" />
                  답글
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {(c.mine || isAdmin) &&
        (editingId === c.id ? (
          <div className="mt-1 flex shrink-0 gap-1.5">
            <button
              onClick={() => onSaveEdit(c.id)}
              disabled={saving || !editContent.trim()}
              aria-label="댓글 수정 저장"
              className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Check className="size-3.5" />
            </button>
            <button
              onClick={onCancelEdit}
              aria-label="수정 취소"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="mt-1 flex shrink-0 gap-1.5">
            {c.mine && !!c.content && (
              <button
                onClick={() => onStartEdit(c)}
                aria-label="내 댓글 수정"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
            <button
              onClick={() => onRemove(c)}
              aria-label={c.mine ? "내 댓글 삭제" : "댓글 삭제 (관리자)"}
              className={cn(
                "text-muted-foreground transition-colors",
                c.mine ? "hover:text-foreground" : "hover:text-destructive"
              )}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
    </div>
  );
}

// 답글 스레드: "답글 N개 보기" 토글 + 답글 목록 + 답글 입력창
function ReplyThread({
  replies,
  showReplies,
  setShowReplies,
  replyOpen,
  setReplyOpen,
  parentDeleted = false,
  stockCode,
  byId,
  isAdmin,
  editingId,
  editContent,
  saving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditContentChange,
  onRemove,
  onToggleLike,
  onReplied,
  parentId,
  parentNickname,
}: {
  replies: StockComment[];
  showReplies: boolean;
  setShowReplies: (v: boolean) => void;
  replyOpen: boolean;
  setReplyOpen: (v: boolean) => void;
  parentDeleted?: boolean;
  stockCode: string;
  byId: Map<string, CatalogSticker>;
  isAdmin: boolean;
  editingId: number | null;
  editContent: string;
  saving: boolean;
  onStartEdit: (c: StockComment) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onEditContentChange: (v: string) => void;
  onRemove: (c: StockComment) => void;
  onToggleLike: (c: StockComment) => void;
  onReplied: () => void;
  parentId: number;
  parentNickname: string;
}) {
  const hasReplies = replies.length > 0;
  return (
    <div className="mt-1 pl-4">
      {hasReplies && (
        <button
          onClick={() => setShowReplies(!showReplies)}
          className="text-xs font-medium text-primary-accent hover:underline"
        >
          {showReplies ? "답글 숨기기" : `답글 ${replies.length}개 보기`}
        </button>
      )}
      {showReplies && (
        <div className="mt-1 flex flex-col gap-2 border-l border-border/60 pl-3">
          {replies.map((r) =>
            r.deleted ? (
              <p key={r.id} className="text-xs italic text-muted-foreground">
                삭제된 댓글입니다.
              </p>
            ) : (
              <CommentBody
                key={r.id}
                c={r}
                byId={byId}
                isAdmin={isAdmin}
                editingId={editingId}
                editContent={editContent}
                saving={saving}
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                onSaveEdit={onSaveEdit}
                onEditContentChange={onEditContentChange}
                onRemove={onRemove}
                onToggleLike={onToggleLike}
              />
            )
          )}
        </div>
      )}
      {replyOpen && !parentDeleted && (
        <ReplyComposer
          stockCode={stockCode}
          parentId={parentId}
          parentNickname={parentNickname}
          onDone={() => {
            setReplyOpen(false);
            setShowReplies(true);
            onReplied();
          }}
        />
      )}
    </div>
  );
}

// 답글 입력창: @부모작성자 프리필. 텍스트 전용(스티커는 최상위만).
function ReplyComposer({
  stockCode,
  parentId,
  parentNickname,
  onDone,
}: {
  stockCode: string;
  parentId: number;
  parentNickname: string;
  onDone: () => void;
}) {
  const [value, setValue] = useState(`@${parentNickname} `);
  const [busy, setBusy] = useState(false);

  async function send() {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await postJson(`/api/stocks/${stockCode}/comments`, {
        content: trimmed,
        parentId,
      });
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "답글 작성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex gap-2">
      <Input
        placeholder="답글 남기기 (200자)"
        value={value}
        maxLength={200}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && send()}
      />
      <Button size="sm" onClick={send} disabled={busy || !value.trim()}>
        답글
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 + 린트**

Run: `npm run build && npx eslint src/components/trade/StockComments.tsx`
Expected: 통과.

- [ ] **Step 3: 커밋**

```bash
git add src/components/trade/StockComments.tsx
git commit -m "feat: 종목 토론방 대댓글 스레드·묘비 렌더 UI"
```

---

### Task 5: 전체 토론 피드 UI — 최상위만 + 답글 개수

**Files:**
- Modify: `src/components/news/DiscussionList.tsx`

**Interfaces:**
- Consumes: `/api/comments?page=1` GET가 반환하는 `DiscussionComment`(with `replyCount`, `deleted`).
- Produces: 없음.

- [ ] **Step 1: 인터페이스에 replyCount·deleted 추가 + 렌더 반영**

`DiscussionComment` 인터페이스에 필드를 추가하고, 카드 본문에 묘비 처리와 "답글 N" 배지를 넣는다. 아래 두 곳을 수정한다.

인터페이스(파일 상단) 교체:

```tsx
interface DiscussionComment {
  id: number;
  nickname: string;
  content: string | null;
  createdAt: string;
  mine: boolean;
  likeCount: number;
  likedByMe: boolean;
  stockCode: string;
  stockName: string;
  representativeBadge: WeeklyBadge | null;
  stickerId: string | null;
  deleted: boolean;
  replyCount: number;
}
```

카드 렌더(`data?.comments.map(...)` 반환 `<article>`) 교체:

```tsx
        <article
          key={c.id}
          className="rounded-xl border border-foreground/[0.14] bg-card px-4 py-3 shadow-sm"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {!c.deleted && (
              <>
                <span className="font-medium text-foreground">{c.nickname}</span>
                {c.representativeBadge && <BadgeChip badge={c.representativeBadge} />}
                <span>·</span>
              </>
            )}
            <span>{relativeTime(c.createdAt)}</span>
            <Link href={`/stocks/${c.stockCode}`} className="ml-auto">
              <Badge className="cursor-pointer bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground">
                {c.stockName}
              </Badge>
            </Link>
          </div>
          {c.deleted ? (
            <p className="mt-1 text-sm italic text-muted-foreground">삭제된 댓글입니다.</p>
          ) : (
            <>
              {c.content && <p className="mt-1 break-words text-sm">{c.content}</p>}
              {c.stickerId && byId.get(c.stickerId) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={byId.get(c.stickerId)!.imageUrl}
                  alt={byId.get(c.stickerId)!.label}
                  className="mt-1 size-24 object-contain"
                />
              )}
            </>
          )}
          <div className="mt-1.5 flex items-center gap-3">
            {!c.deleted && (
              <button
                onClick={() => toggleLike(c)}
                aria-label={c.likedByMe ? "엄지업 취소" : "엄지업"}
                className={`inline-flex items-center gap-1 text-xs transition-colors ${
                  c.likedByMe
                    ? "text-primary-accent"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ThumbsUp className={`size-3.5 ${c.likedByMe ? "fill-current" : ""}`} />
                {c.likeCount > 0 && <span>{c.likeCount}</span>}
              </button>
            )}
            {c.replyCount > 0 && (
              <Link
                href={`/stocks/${c.stockCode}`}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <MessageCircle className="size-3.5" />
                답글 {c.replyCount}
              </Link>
            )}
          </div>
        </article>
```

- [ ] **Step 2: MessageCircle 임포트 추가**

파일 상단 lucide-react 임포트를 교체한다:

```tsx
import { MessageCircle, ThumbsUp } from "lucide-react";
```

- [ ] **Step 3: 빌드 + 린트**

Run: `npm run build && npx eslint src/components/news/DiscussionList.tsx`
Expected: 통과.

- [ ] **Step 4: 커밋**

```bash
git add src/components/news/DiscussionList.tsx
git commit -m "feat: 전체 토론 피드 최상위만·답글 개수 표시"
```

---

### Task 6: 루머 "미확인" 배지

**Files:**
- Modify: `src/components/news/NewsList.tsx`

**Interfaces:**
- Consumes: `GRADE_META`(기존), `NewsGrade`.
- Produces: 없음.

- [ ] **Step 1: GRADE_META에 label 필드 추가**

`GradeMeta` 인터페이스와 `GRADE_META` 상수를 교체한다:

```tsx
interface GradeMeta {
  verified: boolean;
  avatarClass: string;
  checkClass: string;
  label?: string; // 미인증 등급 경고 칩 문구 (없으면 미표시)
}

const GRADE_META: Record<NewsGrade, GradeMeta> = {
  disclosure: {
    verified: true,
    avatarClass: "bg-secondary text-secondary-foreground",
    checkClass: "text-secondary-foreground",
  },
  news: {
    verified: true,
    avatarClass: "bg-primary text-primary-foreground",
    checkClass: "text-primary-accent",
  },
  rumor: {
    verified: false,
    avatarClass: "border border-border bg-muted text-muted-foreground",
    checkClass: "",
    label: "미확인",
  },
};
```

- [ ] **Step 2: 헤더에 미확인 칩 렌더**

헤더 행(`{meta.verified && (<BadgeCheck .../>)}` 다음 줄, `<span ...>{author.handle}</span>` 앞)에 칩을 추가한다. 아래 블록을 `{meta.verified && (...)}` 직후에 삽입:

```tsx
                {meta.label && (
                  <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium leading-none text-muted-foreground">
                    {meta.label}
                  </span>
                )}
```

- [ ] **Step 3: 빌드 + 린트**

Run: `npm run build && npx eslint src/components/news/NewsList.tsx`
Expected: 통과.

- [ ] **Step 4: 커밋**

```bash
git add src/components/news/NewsList.tsx
git commit -m "feat: 찌라시 뉴스에 미확인 배지 추가"
```

---

### Task 7: 통합 검증 (실앱)

**Files:** 없음(검증 전용).

**Interfaces:**
- Consumes: Task 1~6 전체.

- [ ] **Step 1: 전체 빌드·린트**

Run: `npm run build && npx eslint src`
Expected: 에러 0.

- [ ] **Step 2: 로컬 DB 리셋 + reset 함수 무결성 확인**

Run: `npx supabase db reset`
Expected: 마이그레이션 전부 적용. `reset_rehearsal_data`는 `users` cascade로 댓글/답글/반응을 자동 정리하므로 수정 불필요 — reset 함수 마이그레이션은 건드리지 않는다.

- [ ] **Step 3: verify 스킬로 실앱 시나리오 검증**

verify 스킬(agent-browser)로 다음을 확인한다(테스트 유저 seed → 시나리오 → 정리):
1. 종목 상세 토론방에서 댓글 작성 → "답글" 탭 → 답글 작성 → "답글 1개 보기" 토글 노출·펼침.
2. 답글에는 "답글" 버튼이 없다(2단계 제한). 답글에서 대화 잇기는 `@닉네임` 프리필 텍스트로 확인.
3. 답글이 달린 부모를 삭제 → "삭제된 댓글입니다" 묘비 + 답글 보존 확인.
4. 답글 없는 댓글 삭제 → 완전히 사라짐(하드 삭제).
5. 뉴스 탭에서 찌라시 등급 게시물에 "미확인" 칩 노출, 공시·정식 뉴스엔 없음.
6. 전체 토론(⟨뉴스|토론⟩ 세그먼트)에서 최상위 댓글만·"답글 N" 개수 노출, 답글 입력창 없음.

- [ ] **Step 4: ROADMAP·메모리 갱신은 병합 단계에서**

배포·병합은 `superpowers:finishing-a-development-branch`로 진행(PR 생성). prod 배포 시 마이그 `20260719000000` push + 리허설 재생성 필요([[rehearsal-reset-before-open]]).

---

## Self-Review

**Spec coverage:**
- 데이터 모델(parent_id·deleted_at·제약 완화) → Task 1 ✅
- 삭제 정책(묘비/하드 분기) → Task 2 Step 4 ✅
- 서버 중첩 조립·2단계 검증 → Task 2 Step 1~3 ✅
- listAllComments 최상위+replyCount → Task 2 Step 5 ✅
- API parentId → Task 3 ✅
- 종목 토론방 UI(답글 토글·입력·묘비·@멘션 프리필) → Task 4 ✅
- 전체 토론 피드(최상위+답글개수) → Task 5 ✅
- 루머 미확인 배지 → Task 6 ✅
- 검증 계획(build/lint/reset/verify) → Task 7 ✅

**Placeholder scan:** TBD/TODO/"적절히 처리" 없음. 모든 코드 스텝에 실제 코드 포함.

**Type consistency:**
- `StockComment`: content `string | null`, `deleted`, `replies?` — Task 2 정의 → Task 4 클라 인터페이스 일치 ✅
- `DiscussionComment`: `replyCount`, `deleted` — Task 2 → Task 5 일치 ✅
- `createComment(userId, stockCode, content, stickerId, parentId)` — Task 2 정의 → Task 3 호출 인자 5개 일치 ✅
- `GradeMeta.label?` — Task 6 정의·사용 일치 ✅
- 삭제 헬퍼 `performDelete(commentId, restrictUserId)` — Task 2 내부 일관 ✅

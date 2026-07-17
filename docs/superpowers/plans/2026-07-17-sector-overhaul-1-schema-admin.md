# 섹터 개편 Plan 1 — 섹터 데이터화 + 어드민 관리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 섹터를 하드코딩(CHECK·TS유니온·라벨맵)에서 `sectors` 테이블로 승격하고, 어드민이 섹터 추가·이름수정·정렬·삭제 및 종목 섹터 재배치를 콘솔에서 할 수 있게 한다. **게임 동작·가격·뉴스는 변하지 않는다**(순수 기반 작업).

**Architecture:** `sectors` 테이블(code PK, label_ko, sort_order) + `stocks.sector` FK. 기존 9섹터 + 신규 9섹터(에너지·소재·식음료·화장품·통신·건설·로봇·게임·조선우주항공) 18행을 seed. adminService에 CRUD 5함수 추가 → `/api/admin/sectors`·`/api/admin/stocks/sector` 라우트 → 어드민 콘솔 `SectorSection` + StockSection 섹터 드롭다운.

**Tech Stack:** Next.js 16(App Router)·React 19·TS5(strict) / Supabase(Postgres+RLS, service-role client) / TanStack Query v5 / zod v4 / shadcn/ui·lucide-react.

## Global Constraints

- TypeScript strict — `any` 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트.
- 코드 주석·커밋 메시지 한국어. 커밋 형식 `type: 한국어 설명`. 커밋 말미 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- 임포트 개별 임포트(lucide-react 포함), 경로 alias `@/*`.
- API 응답은 `ApiResponse<T>` 래퍼(`apiOk`/`apiError`/`handleApiError`), 서비스는 `ApiException(code,msg)`로 던짐. 모든 `/api/admin/*`는 `requireAdmin()` 통과 후 서비스 호출.
- 서비스 파일은 `import "server-only"`. DB 쓰기는 `getSupabaseAdmin()`(service-role, RLS 우회).
- UI 문구 이모지 금지.
- **섹터 코드 = 소문자 slug**(`^[a-z][a-z0-9_]{1,29}$`). 신규 9코드: `energy, materials, food, cosmetics, telecom, construction, robotics, game, shipaero`.
- **테스트 러너 없음.** 검증은 `npx supabase db reset`(마이그레이션+seed) + `psql`(로컬 54322) + `npm run build` + `npm run lint` + `verify` 스킬(agent-browser)로 한다.

---

## File Structure

- `supabase/migrations/20260717010000_sectors_table.sql` — **생성**. sectors 테이블·seed 18행·CHECK 제거·FK·RLS.
- `src/types/domain.ts` — **수정**. `StockSector` 유니온 → `string` 별칭, `Sector` 인터페이스 추가.
- `src/services/adminService.ts` — **수정**. 섹터 CRUD 5함수 추가(파일 하단).
- `src/app/api/admin/sectors/route.ts` — **생성**. GET·POST·PATCH·DELETE.
- `src/app/api/admin/stocks/sector/route.ts` — **생성**. PATCH(종목 재배치).
- `src/components/admin/SectorSection.tsx` — **생성**. 섹터 관리 UI.
- `src/components/admin/StockSection.tsx` — **수정**. 종목 행에 섹터 드롭다운.
- `src/app/admin/page.tsx` — **수정**. `manage` 탭에 `SectorSection` 마운트.

---

## Task 1: sectors 테이블 마이그레이션

**Files:**
- Create: `supabase/migrations/20260717010000_sectors_table.sql`

**Interfaces:**
- Produces: `sectors(code text pk, label_ko text, sort_order int, created_at timestamptz)`; `stocks.sector` FK → `sectors.code`. seed 18 코드.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
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
```

- [ ] **Step 2: 로컬 DB 리셋으로 적용 확인**

Run: `npx supabase db reset`
Expected: 에러 없이 완료(모든 마이그레이션 + `supabase/seed.sql` 재적용).

- [ ] **Step 3: seed 수·FK 검증 쿼리**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"select count(*) as sectors from sectors;
 select count(*) as fk from pg_constraint where conname='stocks_sector_fkey';
 select count(*) as orphan from stocks s left join sectors se on se.code=s.sector where se.code is null;"
```
Expected: `sectors=18`, `fk=1`, `orphan=0`.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260717010000_sectors_table.sql
git commit -m "feat: sectors 테이블·FK·seed 18섹터 (섹터 데이터화)"
```

---

## Task 2: 도메인 타입 완화 + Sector 타입

**Files:**
- Modify: `src/types/domain.ts:4-13` (StockSector 유니온), 인터페이스 추가

**Interfaces:**
- Produces: `type StockSector = string`; `interface Sector { code: string; labelKo: string; sortOrder: number }`.
- Consumes: 없음.

- [ ] **Step 1: `StockSector` 유니온을 string으로 완화하고 Sector 추가**

`src/types/domain.ts`의 4~13행 `StockSector` 유니온 정의를 아래로 교체:

```ts
// 섹터는 이제 sectors 테이블의 동적 데이터다(어드민 관리). 코드는 소문자 slug.
export type StockSector = string;

export interface Sector {
  code: string;
  labelKo: string;
  sortOrder: number;
}
```

- [ ] **Step 2: 타입 체크**

Run: `npm run build`
Expected: 성공. (`s.sector as StockSector` 캐스트는 string 별칭이라 그대로 유효 — 수정 불필요.)

- [ ] **Step 3: 커밋**

```bash
git add src/types/domain.ts
git commit -m "refactor: StockSector를 동적 string으로 완화, Sector 타입 추가"
```

---

## Task 3: adminService 섹터 CRUD 5함수

**Files:**
- Modify: `src/services/adminService.ts` (파일 하단에 추가; 상단 import에 `Sector` 추가)

**Interfaces:**
- Consumes: `getSupabaseAdmin()`, `ApiException`(둘 다 이미 import됨), `Sector`(Task 2).
- Produces:
  - `listSectors(): Promise<Sector[]>`
  - `createSector(input: { code: string; labelKo: string; sortOrder: number }): Promise<void>`
  - `updateSector(code: string, patch: { labelKo?: string; sortOrder?: number }): Promise<void>`
  - `deleteSector(code: string): Promise<void>`
  - `setStockSector(code: string, sector: string): Promise<void>`

- [ ] **Step 1: 상단 타입 import에 `Sector` 추가**

`src/services/adminService.ts:29`의 import 라인을 교체:

```ts
import type { AdminSignupRequest, Sector, Stock, StockSector, StockTier } from "@/types/domain";
```

- [ ] **Step 2: 파일 하단에 섹터 CRUD 추가**

`src/services/adminService.ts` 맨 끝에 append:

```ts

// ── 섹터 관리 (섹터 개편) ──────────────────────────────────────
// 섹터는 sectors 테이블 데이터. 어드민이 추가·이름수정·정렬·삭제·종목배치를 한다.

export async function listSectors(): Promise<Sector[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sectors")
    .select("code, label_ko, sort_order")
    .order("sort_order");
  if (error) throw error;
  return data.map((s) => ({
    code: s.code,
    labelKo: s.label_ko,
    sortOrder: s.sort_order,
  }));
}

export interface CreateSectorInput {
  code: string;
  labelKo: string;
  sortOrder: number;
}

export async function createSector(input: CreateSectorInput): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("sectors").insert({
    code: input.code,
    label_ko: input.labelKo,
    sort_order: input.sortOrder,
  });
  if (error) {
    if (error.code === "23505") {
      throw new ApiException("VALIDATION", "이미 존재하는 섹터 코드입니다.");
    }
    throw error;
  }
}

export async function updateSector(
  code: string,
  patch: { labelKo?: string; sortOrder?: number }
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.labelKo !== undefined) update.label_ko = patch.labelKo;
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
  if (Object.keys(update).length === 0) return;
  const { error } = await supabase.from("sectors").update(update).eq("code", code);
  if (error) throw error;
}

export async function deleteSector(code: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { count, error: countError } = await supabase
    .from("stocks")
    .select("code", { count: "exact", head: true })
    .eq("sector", code);
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    throw new ApiException("VALIDATION", "종목이 배치된 섹터는 삭제할 수 없습니다.");
  }
  const { error } = await supabase.from("sectors").delete().eq("code", code);
  if (error) throw error;
}

// 종목 재배치. FK가 무결성을 강제하지만 없는 섹터엔 친절한 에러를 준다.
export async function setStockSector(code: string, sector: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: sec, error: secError } = await supabase
    .from("sectors")
    .select("code")
    .eq("code", sector)
    .maybeSingle();
  if (secError) throw secError;
  if (!sec) {
    throw new ApiException("NOT_FOUND", "없는 섹터입니다.");
  }
  const { error } = await supabase.from("stocks").update({ sector }).eq("code", code);
  if (error) throw error;
}
```

- [ ] **Step 3: 타입/린트 체크**

Run: `npm run build && npm run lint`
Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git add src/services/adminService.ts src/types/domain.ts
git commit -m "feat: adminService 섹터 CRUD·종목 재배치 함수"
```

---

## Task 4: 섹터 관리 API 라우트

**Files:**
- Create: `src/app/api/admin/sectors/route.ts`
- Create: `src/app/api/admin/stocks/sector/route.ts`

**Interfaces:**
- Consumes: Task 3 서비스 함수, `requireAdmin`, `apiOk/apiError/handleApiError`.
- Produces (HTTP):
  - `GET /api/admin/sectors` → `{ sectors: Sector[] }`
  - `POST /api/admin/sectors` body `{ code, labelKo, sortOrder? }` → `{ ok: true }`
  - `PATCH /api/admin/sectors` body `{ code, labelKo?, sortOrder? }` → `{ ok: true }`
  - `DELETE /api/admin/sectors` body `{ code }` → `{ ok: true }`
  - `PATCH /api/admin/stocks/sector` body `{ code, sector }` → `{ ok: true }`

- [ ] **Step 1: 섹터 CRUD 라우트 작성**

`src/app/api/admin/sectors/route.ts`:

```ts
import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import {
  createSector,
  deleteSector,
  listSectors,
  updateSector,
} from "@/services/adminService";

export async function GET() {
  try {
    await requireAdmin();
    return apiOk({ sectors: await listSectors() });
  } catch (error) {
    return handleApiError(error);
  }
}

const codeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,29}$/, "섹터 코드는 소문자 slug(영문 소문자로 시작)여야 합니다");

const createSchema = z.object({
  code: codeSchema,
  labelKo: z.string().min(1).max(20),
  sortOrder: z.number().int().min(0).max(9999).default(100),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    await createSector(parsed.data);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

const updateSchema = z.object({
  code: z.string().min(1),
  labelKo: z.string().min(1).max(20).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "code와 수정할 값(labelKo/sortOrder)이 필요합니다.");
    }
    const { code, ...patch } = parsed.data;
    await updateSector(code, patch);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

const deleteSchema = z.object({ code: z.string().min(1) });

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "code가 필요합니다.");
    }
    await deleteSector(parsed.data.code);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 2: 종목 재배치 라우트 작성**

`src/app/api/admin/stocks/sector/route.ts`:

```ts
import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { setStockSector } from "@/services/adminService";

const schema = z.object({ code: z.string().min(1), sector: z.string().min(1) });

// 종목 섹터 재배치
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "code와 sector가 필요합니다.");
    }
    await setStockSector(parsed.data.code.toUpperCase(), parsed.data.sector);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 3: 빌드/린트**

Run: `npm run build && npm run lint`
Expected: 성공.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/admin/sectors/route.ts src/app/api/admin/stocks/sector/route.ts
git commit -m "feat: 섹터 CRUD·종목 재배치 어드민 API 라우트"
```

---

## Task 5: 어드민 콘솔 UI — 섹터 관리 + 종목 섹터 드롭다운

**Files:**
- Create: `src/components/admin/SectorSection.tsx`
- Modify: `src/components/admin/StockSection.tsx` (종목 행에 섹터 select 추가)
- Modify: `src/app/admin/page.tsx` (`manage` 탭에 `SectorSection` 마운트)

**Interfaces:**
- Consumes: `getJson/postJson/patchJson/deleteJson`(`@/lib/api/client`), Task 4 라우트, `Sector`(Task 2).
- Produces: `<SectorSection />` React 컴포넌트.

- [ ] **Step 1: SectorSection 컴포넌트 작성**

`src/components/admin/SectorSection.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteJson, getJson, patchJson, postJson } from "@/lib/api/client";
import type { Sector } from "@/types/domain";

export function SectorSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-sectors"],
    queryFn: () => getJson<{ sectors: Sector[] }>("/api/admin/sectors"),
  });
  const sectors = data?.sectors ?? [];

  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-sectors"] });
    qc.invalidateQueries({ queryKey: ["admin-stocks"] });
  };

  const create = useMutation({
    mutationFn: () =>
      postJson("/api/admin/sectors", {
        code: newCode.trim(),
        labelKo: newLabel.trim(),
        sortOrder: (sectors.at(-1)?.sortOrder ?? 100) + 10,
      }),
    onSuccess: () => {
      setNewCode("");
      setNewLabel("");
      invalidate();
    },
    onError: (e: Error) => alert(e.message),
  });

  const rename = useMutation({
    mutationFn: (v: { code: string; labelKo: string }) =>
      patchJson("/api/admin/sectors", v),
    onSuccess: invalidate,
    onError: (e: Error) => alert(e.message),
  });

  const remove = useMutation({
    mutationFn: (code: string) => deleteJson("/api/admin/sectors", { code }),
    onSuccess: invalidate,
    onError: (e: Error) => alert(e.message),
  });

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">섹터 관리</h2>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">코드(slug)</label>
          <Input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="예: energy"
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">라벨</label>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="예: 에너지·원자력"
            className="w-48"
          />
        </div>
        <Button
          onClick={() => create.mutate()}
          disabled={!newCode.trim() || !newLabel.trim() || create.isPending}
        >
          <Plus className="mr-1 size-4" />
          추가
        </Button>
      </div>

      <ul className="divide-y rounded-md border">
        {sectors.map((s) => (
          <li key={s.code} className="flex items-center gap-3 px-3 py-2">
            <span className="w-32 font-mono text-xs text-muted-foreground">
              {s.code}
            </span>
            <Input
              defaultValue={s.labelKo}
              className="w-48"
              onBlur={(e) => {
                const labelKo = e.target.value.trim();
                if (labelKo && labelKo !== s.labelKo) {
                  rename.mutate({ code: s.code, labelKo });
                }
              }}
            />
            <span className="text-xs text-muted-foreground">정렬 {s.sortOrder}</span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              onClick={() => {
                if (confirm(`섹터 "${s.labelKo}" 삭제? (종목이 배치돼 있으면 실패)`)) {
                  remove.mutate(s.code);
                }
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: StockSection 종목 행에 섹터 드롭다운 추가**

`src/components/admin/StockSection.tsx`에서: (a) 상단에 sectors 쿼리 추가, (b) 각 종목 행에 섹터 select 추가.

파일 상단 import에 추가(이미 `getJson, postJson`가 있음):

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchJson } from "@/lib/api/client";
import type { Sector } from "@/types/domain";
```

컴포넌트 본문 상단(기존 stocks useQuery 근처)에 섹터 목록·재배치 뮤테이션 추가:

```tsx
  const qc = useQueryClient();
  const { data: sectorData } = useQuery({
    queryKey: ["admin-sectors"],
    queryFn: () => getJson<{ sectors: Sector[] }>("/api/admin/sectors"),
  });
  const sectors = sectorData?.sectors ?? [];
  const reassign = useMutation({
    mutationFn: (v: { code: string; sector: string }) =>
      patchJson("/api/admin/stocks/sector", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-stocks"] }),
    onError: (e: Error) => alert(e.message),
  });
```

각 종목 행(기존 등급 컨트롤 옆)에 select 삽입 — `stock`이 행의 종목 객체일 때:

```tsx
  <select
    value={stock.sector}
    onChange={(e) => reassign.mutate({ code: stock.code, sector: e.target.value })}
    className="rounded-md border bg-background px-2 py-1 text-sm"
  >
    {sectors.map((s) => (
      <option key={s.code} value={s.code}>
        {s.labelKo}
      </option>
    ))}
  </select>
```

> 참고: StockSection의 stocks 쿼리는 `["admin-stocks"]` 키를 쓴다(기존). 종목 객체에 `sector` 필드가 이미 있다(`listStocks` 반환). select의 `value={stock.sector}`가 현재 배치를 표시한다.

- [ ] **Step 3: 어드민 페이지 manage 탭에 SectorSection 마운트**

`src/app/admin/page.tsx`: import에 추가 —

```tsx
import { SectorSection } from "@/components/admin/SectorSection";
```

`manage` 탭 `<TabsContent value="manage">` 안, `<StockSection />` 위에 삽입:

```tsx
<SectorSection />
```

- [ ] **Step 4: 빌드/린트**

Run: `npm run build && npm run lint`
Expected: 성공.

- [ ] **Step 5: 실제 앱 검증 (verify 스킬)**

`verify` 스킬(dev 서버 + agent-browser)로:
1. `npx supabase db reset` 후 `npm run dev`.
2. 어드민 로그인 → 콘솔 `#manage` 탭.
3. 섹터 관리에서 코드 `test`, 라벨 `테스트` 추가 → 목록에 18→19개 표시 확인.
4. 종목 하나의 섹터 드롭다운을 다른 섹터로 변경 → 새로고침 후 유지 확인.
5. 방금 만든 `test` 섹터 삭제(종목 없음) → 성공. 종목이 배치된 섹터 삭제 시도 → "종목이 배치된 섹터는 삭제할 수 없습니다" 에러 확인.

Expected: 위 5개 모두 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/components/admin/SectorSection.tsx src/components/admin/StockSection.tsx src/app/admin/page.tsx
git commit -m "feat: 어드민 콘솔 섹터 관리 UI·종목 섹터 재배치 드롭다운"
```

---

## Self-Review (플랜 작성자 체크)

- **스펙 커버리지(Plan 1 범위 §3)**: sectors 테이블(Task 1) ✓ / FK·CHECK 제거(Task 1) ✓ / StockSector 완화(Task 2) ✓ / adminService CRUD 5함수(Task 3) ✓ / 라우트(Task 4) ✓ / 어드민 UI·재배치(Task 5) ✓. 라벨맵(SECTOR_NEWS_LABEL) 제거는 **Plan 3(엔진/뉴스)** 소관 — Plan 1은 뉴스 파이프라인 미접촉(동작 불변). 신규 9섹터 seed는 Task 1에 포함(종목 배치는 Plan 2).
- **플레이스홀더 스캔**: 없음. 모든 코드 블록 실체 포함.
- **타입 일관성**: `Sector { code, labelKo, sortOrder }` — Task 2 정의 = Task 3 반환 = Task 5 소비 동일. 라우트 body 키(`labelKo/sortOrder`) 일관. `setStockSector(code, sector)` 시그니처 = 라우트 = UI 뮤테이션 body(`{code, sector}`) 일관.

---

## 나머지 플랜 순서 (Plan 1 착지 후 각각 별도 작성)

- **Plan 2 — 로스터·자금 마이그레이션**: 신규 15종 insert(신규 기준가·시총 §2.1)·재배치 5종·기존 27종 기준가 갱신·지수 divisor 재부트스트랩·초기자금 1,000만·방문보너스 100만·기존유저 +900만. (Plan 1의 sectors 테이블 FK 전제)
- **Plan 3 — 엔진**: `bias.ts` 참여확률 모델(§4) 재작성, `drawSectorEvents`/`applySectorEvents`, `generateSectorNews` 다건·등급화, `SECTOR_NEWS_LABEL` 제거→DB 라벨 주입. (tsx 시드 검증 스크립트로 결정적 테스트)
- **Plan 4 — 콘텐츠**: 신규 15종 소개문·힌트 템플릿 ~1,275개, 섹터 뉴스 템플릿(§5·§6). (에이전트 병렬 생성 + 캐논 검수 + 검증 스크립트: 종목당 ≥85·제목 중복 0·금지어 0)
- **Plan 5 — 밸런스·배포**: `npm run simulate` 재검증·파라미터 튜닝, prod db push, 리허설 재생성, `verify`. (§7·§8)

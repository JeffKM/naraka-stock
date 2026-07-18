# 출석 스트릭 보너스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 손님이 `/portfolio` 지갑에서 하루 1회 접속만으로 출석 보너스를 받고, 연속 출석(스트릭) 단계별로 30만/50만/70만 원을 지급받는 기능을 구현한다.

**Architecture:** 방문 보너스(`claim_visit_bonus`)와 동일한 "서버 단일 트랜잭션" 패턴을 따른다. 스트릭 계산·금액 산정·지급을 Postgres 함수로 처리하고, 클라이언트는 결과만 표시한다. 매장 방문 보너스와 별개 테이블(`attendance_claims`)로 병존한다.

**Tech Stack:** Supabase(Postgres + RPC), Next.js 16 App Router, React 19, TanStack Query v5, shadcn/ui, sonner.

## Global Constraints

- **모든 돈 계산은 서버 단일 트랜잭션** — 지급은 Postgres 함수 안에서. 클라이언트가 보내는 값 불신.
- **자산은 정수(원)** — 부동소수점 금지. 금액은 `bigint`.
- **금액은 `config`로 관리** — 코드 배포 없이 값 조정. 스트릭 경계(2일/6일)는 함수 상수, 금액만 config.
- **UI 유니코드 이모지 금지** — 문안·배지·표시는 텍스트로만.
- **캐논 어휘 금지** — 저승·천계·도깨비·염라 등 확장 어휘 파생어 금지.
- **TypeScript strict** — `any` 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트, 개별 임포트, 경로 alias `@/*`.
- **API 응답은 `ApiResponse<T>` 래퍼** — `apiOk`/`handleApiError` 사용. 코드 주석·커밋은 한국어.
- **검증 방식** — 이 프로젝트는 유닛 테스트 프레임워크가 없다. DB 함수는 `psql`로 직접 호출해 시나리오 검증하고, TS 코드는 `npm run build` + `npm run lint`로, UI는 verify 스킬(dev + agent-browser)로 검증한다.

---

## File Structure

- **Create** `supabase/migrations/20260718060000_attendance_streak.sql` — `attendance_claims` 테이블, config 3키, 함수 3종(`attendance_amount`/`claim_attendance_bonus`/`attendance_status`), `reset_rehearsal_data` 갱신.
- **Modify** `src/types/api.ts` — `ApiErrorCode`에 `ATTENDANCE_ALREADY_CLAIMED` 추가.
- **Modify** `src/lib/api/response.ts` — `STATUS_BY_CODE`에 신규 코드 매핑.
- **Modify** `src/services/bonusService.ts` — `claimAttendanceBonus`, `getAttendanceStatus` 추가.
- **Create** `src/app/api/attendance/route.ts` — `GET`(상태 조회) + `POST`(수령).
- **Create** `src/components/portfolio/AttendanceCard.tsx` — 출석 카드 UI.
- **Modify** `src/app/portfolio/page.tsx` — 방문 보너스 카드 위에 `AttendanceCard` 삽입.

---

## Task 1: DB 마이그레이션 (테이블 + 함수 3종 + reset 갱신)

**Files:**
- Create: `supabase/migrations/20260718060000_attendance_streak.sql`
- 참조(복제 원본): `supabase/migrations/20260713050000_reset_function.sql`

**Interfaces:**
- Produces (다른 Task가 RPC로 호출):
  - `claim_attendance_bonus(p_user_id bigint, p_at timestamptz default now()) returns jsonb` — `{cash, streak, amount}`. 오늘 이미 받았으면 `ATTENDANCE_ALREADY_CLAIMED` 예외.
  - `attendance_status(p_user_id bigint, p_at timestamptz default now()) returns jsonb` — `{claimedToday bool, currentStreak int, nextAmount bigint, nextStreak int}`.

- [ ] **Step 1: 마이그레이션 파일 작성**

Create `supabase/migrations/20260718060000_attendance_streak.sql`:

```sql
-- 출석 스트릭 보너스 (몰입 스펙 2026-07-18)
--
-- 매장 방문 보너스(claim_visit_bonus, 코드 필요)와 별개로, 하루 1회 단순 접속만으로
-- 현금을 지급한다. 연속 출석(스트릭) 단계별로 증액하고, 하루 결석 시 1일차로 리셋한다.
-- 방문 보너스와 동일하게 지급을 서버 단일 트랜잭션(함수)으로 처리한다.

create table attendance_claims (
  user_id bigint not null references users (id) on delete cascade,
  date date not null,
  streak int not null,
  amount bigint not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- 다른 테이블과 동일하게 RLS 전면 차단 (service role만 통과)
alter table attendance_claims enable row level security;
alter table attendance_claims force row level security;

-- 스트릭 단계별 금액 (경계 2일/6일은 함수 상수, 금액만 config로 조정 가능)
insert into config (key, value) values
  ('attendance_amount_1', '300000'),  -- 연속 1~2일차
  ('attendance_amount_2', '500000'),  -- 연속 3~6일차
  ('attendance_amount_3', '700000')   -- 연속 7일차 이상 (유지)
on conflict (key) do nothing;

-- 스트릭 → 금액. 경계(2/6)는 여기 고정, 금액은 config 조회.
create or replace function attendance_amount(p_streak int)
returns bigint
language sql
stable
as $$
  select (value #>> '{}')::bigint from config
  where key = case
    when p_streak <= 2 then 'attendance_amount_1'
    when p_streak <= 6 then 'attendance_amount_2'
    else 'attendance_amount_3'
  end;
$$;

-- 출석 보너스 수령: 오늘 1회, 연속일 계산 후 단계별 현금 지급.
-- p_at: 테스트용 시각 오버라이드 (기본 now()). KST 날짜 기준.
create or replace function claim_attendance_bonus(
  p_user_id bigint,
  p_at timestamptz default now()
) returns jsonb
language plpgsql
as $$
declare
  v_today date := (p_at at time zone 'Asia/Seoul')::date;
  v_prev date;
  v_streak int;
  v_amount bigint;
  v_cash bigint;
begin
  -- 직전 수령일 (오늘 이전 중 가장 최근)
  select max(date) into v_prev
    from attendance_claims
    where user_id = p_user_id and date < v_today;

  -- 어제 받았으면 스트릭 +1, 아니면(결석·첫 수령) 1일차로 리셋
  if v_prev = v_today - 1 then
    select streak + 1 into v_streak
      from attendance_claims
      where user_id = p_user_id and date = v_prev;
  else
    v_streak := 1;
  end if;

  v_amount := attendance_amount(v_streak);

  -- 오늘 1회 기록 (중복이면 지급 없이 예외)
  begin
    insert into attendance_claims (user_id, date, streak, amount)
      values (p_user_id, v_today, v_streak, v_amount);
  exception when unique_violation then
    raise exception 'ATTENDANCE_ALREADY_CLAIMED';
  end;

  update users set cash = cash + v_amount
    where id = p_user_id
    returning cash into v_cash;

  return jsonb_build_object('cash', v_cash, 'streak', v_streak, 'amount', v_amount);
end $$;

-- 출석 상태 조회 (UI 표시용): 오늘 수령 여부·현재 스트릭·다음 수령 금액.
create or replace function attendance_status(
  p_user_id bigint,
  p_at timestamptz default now()
) returns jsonb
language plpgsql
stable
as $$
declare
  v_today date := (p_at at time zone 'Asia/Seoul')::date;
  v_today_row attendance_claims%rowtype;
  v_prev date;
  v_prev_streak int;
  v_next_streak int;
begin
  select * into v_today_row
    from attendance_claims where user_id = p_user_id and date = v_today;

  if found then
    -- 이미 받음: 현재 스트릭 = 오늘 기록, 다음 금액은 내일(스트릭+1) 기준 참고값
    return jsonb_build_object(
      'claimedToday', true,
      'currentStreak', v_today_row.streak,
      'nextStreak', v_today_row.streak + 1,
      'nextAmount', attendance_amount(v_today_row.streak + 1)
    );
  end if;

  -- 아직 안 받음: 오늘 받으면 될 스트릭 계산
  select max(date) into v_prev
    from attendance_claims where user_id = p_user_id and date < v_today;
  if v_prev = v_today - 1 then
    select streak into v_prev_streak
      from attendance_claims where user_id = p_user_id and date = v_prev;
    v_next_streak := v_prev_streak + 1;
  else
    v_next_streak := 1;
  end if;

  return jsonb_build_object(
    'claimedToday', false,
    'currentStreak', coalesce(v_prev_streak, 0),
    'nextStreak', v_next_streak,
    'nextAmount', attendance_amount(v_next_streak)
  );
end $$;
```

- [ ] **Step 2: reset_rehearsal_data 함수에 attendance_claims 정리 추가**

리허설 초기화 시 출석 기록도 지워야 한다. `supabase/migrations/20260713050000_reset_function.sql`의 `reset_rehearsal_data` 함수 정의 **전체를 복사**해 이 마이그레이션 파일 끝에 `create or replace function`으로 붙이고, 본문의 `delete from visit_claims where true;` 바로 아래 줄에 다음을 추가한다:

```sql
  delete from attendance_claims where true;
```

(나머지 함수 본문은 원본과 동일하게 유지. `create or replace`이므로 전체 재정의가 필요하다.)

- [ ] **Step 3: 로컬 DB에 마이그레이션 적용**

Run:
```bash
npx supabase db reset
```
Expected: 마이그레이션이 순서대로 적용되고 `20260718060000_attendance_streak.sql`까지 에러 없이 완료. `seed.sql` 적용 로그 출력.

- [ ] **Step 4: 스트릭 시나리오를 SQL로 검증**

테스트 유저를 만들고 여러 날(`p_at`)에 걸쳐 함수를 호출해 스트릭·금액·리셋을 확인한다.

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
-- 테스트 유저 (cash 0으로 시작)
insert into users (nickname, password_hash, cash, is_admin)
  values ('출석테스트', 'x', 0, false)
  returning id \gset
-- 1일차: streak=1, amount=30만
select claim_attendance_bonus(:id, '2026-08-01 13:00+09');
-- 같은 날 재시도: 예외
select claim_attendance_bonus(:id, '2026-08-01 20:00+09');  -- ATTENDANCE_ALREADY_CLAIMED 기대
SQL
```
Expected: 첫 호출 `{"cash": 300000, "streak": 1, "amount": 300000}`. 두 번째 호출은 `ERROR: ATTENDANCE_ALREADY_CLAIMED`.

- [ ] **Step 5: 연속·증액·리셋 검증**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
select id from users where nickname='출석테스트' \gset
-- 연속 2·3·...·7일차 (증액 확인)
select claim_attendance_bonus(:id, '2026-08-02 13:00+09');  -- streak 2, 30만
select claim_attendance_bonus(:id, '2026-08-03 13:00+09');  -- streak 3, 50만
select claim_attendance_bonus(:id, '2026-08-04 13:00+09');  -- streak 4, 50만
select claim_attendance_bonus(:id, '2026-08-05 13:00+09');  -- streak 5, 50만
select claim_attendance_bonus(:id, '2026-08-06 13:00+09');  -- streak 6, 50만
select claim_attendance_bonus(:id, '2026-08-07 13:00+09');  -- streak 7, 70만
-- 하루 결석(08-08 스킵) 후 08-09: 리셋
select claim_attendance_bonus(:id, '2026-08-09 13:00+09');  -- streak 1, 30만
-- 상태 조회 (08-09 이미 받음)
select attendance_status(:id, '2026-08-09 15:00+09');
-- 정리
delete from users where nickname='출석테스트';
SQL
```
Expected: streak이 2→3→…→7로 오르며 amount가 30만(≤2)→50만(3~6)→70만(7)으로 증액. 08-09는 `streak:1, amount:300000`(결석 리셋). `attendance_status`는 `{"claimedToday": true, "currentStreak": 1, "nextStreak": 2, "nextAmount": 300000}`.

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/20260718060000_attendance_streak.sql
git commit -m "feat: 출석 스트릭 보너스 DB 함수·테이블 추가

attendance_claims 테이블 + config 3키 + 함수 3종(금액·수령·상태).
스트릭 30/50/70만 단계, 결석 시 1일차 리셋. reset_rehearsal_data도 정리 대상에 편입."
```

---

## Task 2: 서비스 + API route + 타입

**Files:**
- Modify: `src/types/api.ts`
- Modify: `src/lib/api/response.ts:5-23`
- Modify: `src/services/bonusService.ts`
- Create: `src/app/api/attendance/route.ts`

**Interfaces:**
- Consumes: `claim_attendance_bonus`, `attendance_status` RPC (Task 1).
- Produces (Task 3이 fetch로 호출):
  - `GET /api/attendance` → `{ claimedToday: boolean; currentStreak: number; nextStreak: number; nextAmount: number }`
  - `POST /api/attendance` → `{ cash: number; streak: number; amount: number }`

- [ ] **Step 1: ApiErrorCode에 신규 코드 추가**

Modify `src/types/api.ts` — `"BANNED"` 라인 위에 추가:

```ts
  | "ATTENDANCE_ALREADY_CLAIMED" // 오늘 출석 보너스 이미 수령
  | "BANNED" // 정지 계정
```

- [ ] **Step 2: STATUS_BY_CODE에 매핑 추가**

Modify `src/lib/api/response.ts` — `STATUS_BY_CODE`의 `BANNED: 403,` 위에 추가:

```ts
  ATTENDANCE_ALREADY_CLAIMED: 409,
  BANNED: 403,
```

- [ ] **Step 3: bonusService에 출석 함수 2종 추가**

Modify `src/services/bonusService.ts` — 파일 끝에 추가:

```ts
export interface AttendanceResult {
  cash: number; // 지급 후 현금 잔고
  streak: number; // 이번 수령의 연속일
  amount: number; // 이번 지급액
}

export interface AttendanceStatus {
  claimedToday: boolean;
  currentStreak: number;
  nextStreak: number;
  nextAmount: number;
}

// 출석 보너스 수령: 스트릭 계산·지급을 DB 함수 단일 트랜잭션으로 처리
export async function claimAttendanceBonus(userId: number): Promise<AttendanceResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("claim_attendance_bonus", {
    p_user_id: userId,
  });

  if (error) {
    if (error.message.includes("ATTENDANCE_ALREADY_CLAIMED")) {
      throw new ApiException(
        "ATTENDANCE_ALREADY_CLAIMED",
        "오늘은 이미 출석 보너스를 받았습니다."
      );
    }
    throw error;
  }

  return data as AttendanceResult;
}

// 출석 상태 조회 (UI 표시용)
export async function getAttendanceStatus(userId: number): Promise<AttendanceStatus> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("attendance_status", {
    p_user_id: userId,
  });
  if (error) throw error;
  return data as AttendanceStatus;
}
```

- [ ] **Step 4: API route 작성**

Create `src/app/api/attendance/route.ts`:

```ts
import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { claimAttendanceBonus, getAttendanceStatus } from "@/services/bonusService";

// 출석 상태 조회 (오늘 수령 여부·스트릭·다음 금액)
export async function GET() {
  try {
    const user = await requireUser();
    return apiOk(await getAttendanceStatus(user.id));
  } catch (error) {
    return handleApiError(error);
  }
}

// 출석 보너스 수령 (하루 1회, 단순 접속 기준 — 입력값 없음)
export async function POST() {
  try {
    const user = await requireUser();
    return apiOk(await claimAttendanceBonus(user.id));
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 5: 빌드·린트 검증**

Run:
```bash
npm run build && npm run lint
```
Expected: 타입 에러·린트 에러 없이 통과. (`ATTENDANCE_ALREADY_CLAIMED`가 `STATUS_BY_CODE`에 매핑돼 있어 `Record` 타입 완전성 통과.)

- [ ] **Step 6: 커밋**

```bash
git add src/types/api.ts src/lib/api/response.ts src/services/bonusService.ts src/app/api/attendance/route.ts
git commit -m "feat: 출석 보너스 서비스·API route 추가

GET/POST /api/attendance — 상태 조회·수령. ATTENDANCE_ALREADY_CLAIMED 에러코드 추가."
```

---

## Task 3: UI — AttendanceCard + 지갑 통합

**Files:**
- Create: `src/components/portfolio/AttendanceCard.tsx`
- Modify: `src/app/portfolio/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/attendance` (Task 2), `getJson`/`postJson`(`@/lib/api/client`), `formatMoney`(`@/lib/market`).

- [ ] **Step 1: AttendanceCard 컴포넌트 작성**

Create `src/components/portfolio/AttendanceCard.tsx`:

```tsx
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getJson, postJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";

interface AttendanceStatus {
  claimedToday: boolean;
  currentStreak: number;
  nextStreak: number;
  nextAmount: number;
}

// 출석 보너스 카드 — 하루 1회 접속만으로 스트릭 단계별 현금 지급
export function AttendanceCard() {
  const queryClient = useQueryClient();
  const [claiming, setClaiming] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["attendance"],
    queryFn: () => getJson<AttendanceStatus>("/api/attendance"),
  });

  async function claim() {
    if (claiming || status?.claimedToday) return;
    setClaiming(true);
    try {
      const { amount, streak } = await postJson<{
        cash: number;
        streak: number;
        amount: number;
      }>("/api/attendance");
      toast.success(`출석 보너스 +${formatMoney(amount)}원! ${streak}일 연속 출석 중`);
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "출석 보너스 수령에 실패했습니다.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">출석 보너스</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading || !status ? (
          <Skeleton className="h-10 w-full" />
        ) : status.claimedToday ? (
          <p className="text-sm text-muted-foreground">
            오늘 출석 완료 · {status.currentStreak}일 연속 출석 중
            <br />
            내일 오면 {formatMoney(status.nextAmount)}원을 받아요
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              오늘 접속하면 {status.nextStreak}일차 출석 보너스 {formatMoney(status.nextAmount)}원
              {status.currentStreak === 0 && " (매일 오면 점점 커져요)"}
            </p>
            <Button onClick={claim} disabled={claiming}>
              출석 보너스 받기
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: 지갑 페이지에 AttendanceCard 삽입**

Modify `src/app/portfolio/page.tsx`:

임포트 추가 (`MyOrdersCard` 임포트 아래):
```tsx
import { AttendanceCard } from "@/components/portfolio/AttendanceCard";
```

`<MyOrdersCard />` 아래, `매장 방문 보너스` `<Card>` 위에 삽입:
```tsx
      <MyOrdersCard />

      <AttendanceCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">매장 방문 보너스</CardTitle>
```

- [ ] **Step 3: 빌드·린트 검증**

Run:
```bash
npm run build && npm run lint
```
Expected: 통과.

- [ ] **Step 4: 실제 앱 검증 (verify 스킬)**

verify 스킬(dev 서버 + agent-browser)로 확인:
1. 로그인 후 `/portfolio` 진입 → "출석 보너스" 카드 노출.
2. "출석 보너스 받기" 클릭 → 토스트 `출석 보너스 +300,000원! 1일 연속 출석 중`, 총자산·현금 증가.
3. 카드가 "오늘 출석 완료 · 1일 연속" 상태로 전환, 버튼 사라짐.
4. 새로고침해도 "오늘 출석 완료" 유지(중복 수령 불가).

Expected: 위 4가지 모두 정상.

- [ ] **Step 5: 커밋**

```bash
git add src/components/portfolio/AttendanceCard.tsx src/app/portfolio/page.tsx
git commit -m "feat: 지갑에 출석 보너스 카드 추가

접속 1회 수령·스트릭 표시·다음 금액 안내. 방문 보너스와 별개 카드로 병존."
```

---

## 배포 주의 (개장 전)

- 마이그레이션 1종(`20260718060000`)은 리허설 재생성 + prod push 절차 필요 ([[rehearsal-reset-before-open]], [[sector-overhaul-deploy-lessons]] 참조). 코드 배포(main 머지→Vercel)가 배치보다 먼저.
- 밸런스는 `--attendance` 시뮬로 검증 완료(스펙 참조). 금액 조정 시 config 3키만 변경.

## Self-Review 체크

- 스펙 §①(출석 스트릭)의 모든 요구사항 — 접속 기준·30/50/70만·결석 리셋·방문 병존·config 관리·simulate 반영 — 이 계획의 Task로 커버됨.
- 스트릭 경계(2/6)·금액(30/50/70만)은 스펙과 일치.
- 함수 시그니처(`claim_attendance_bonus`/`attendance_status`)가 Task 2·3에서 동일하게 참조됨.

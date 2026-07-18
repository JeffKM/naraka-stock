# 라이트모드 기본 + 지갑탭 서브탭 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 색상 모드 기본값을 라이트로 바꾸고, 지갑(`/portfolio`) 페이지를 자산/활동/내역 3개 서브탭(세그먼트)으로 분리한다.

**Architecture:** (1) `Providers.tsx`의 `defaultTheme`만 변경. (2) 뉴스탭에 로컬 정의된 `SegmentButton`을 공용 컴포넌트로 추출해 뉴스탭·지갑탭이 공유. (3) `PortfolioPage`에 클라이언트 세그먼트 상태를 추가해 기존 카드들을 조건부 렌더링으로 재배치(카드 내부 로직은 무변).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, TailwindCSS v4, next-themes.

## Global Constraints

- TypeScript strict — `any` 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트.
- 개별 임포트, 경로 alias `@/*` → `./src/*`.
- 커밋 메시지: `type: 한국어 설명` (feat/fix/refactor/docs 등).
- 컴포넌트 PascalCase 파일명, 변수/함수 camelCase.
- `"use client"`는 필요한 경우만(세 파일 모두 이미 클라이언트 컴포넌트).

---

### Task 1: 라이트모드 기본값 변경

**Files:**
- Modify: `src/components/Providers.tsx:9`, `src/components/Providers.tsx:24`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (설정값 변경만)

- [ ] **Step 1: `defaultTheme`와 주석 변경**

`src/components/Providers.tsx` 9번 줄 주석:
```tsx
// 색상 모드: 라이트 기본, 설정 모달에서 다크/라이트 수동 전환 (시스템 연동 없음)
```

24번 줄:
```tsx
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
```

- [ ] **Step 2: 빌드로 검증**

Run: `npm run build`
Expected: 성공 (타입/컴파일 에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/components/Providers.tsx
git commit -m "feat: 색상 모드 기본값 라이트로 변경"
```

---

### Task 2: SegmentButton 공용 컴포넌트 추출

뉴스탭의 로컬 `SegmentButton`을 `src/components/ui/SegmentButton.tsx`로 옮기고, 뉴스탭은 import로 전환한다. 순수 이동이므로 뉴스탭 동작·스타일은 변하지 않는다.

**Files:**
- Create: `src/components/ui/SegmentButton.tsx`
- Modify: `src/app/news/page.tsx` (로컬 정의 삭제 + import 추가)

**Interfaces:**
- Produces: `SegmentButton` — `(props: { active: boolean; onClick: () => void; children: React.ReactNode }) => JSX.Element`. Task 3(지갑탭)이 이 컴포넌트를 import해 사용.

- [ ] **Step 1: 공용 컴포넌트 파일 생성**

`src/components/ui/SegmentButton.tsx` (뉴스탭 기존 구현을 그대로 이동):
```tsx
import { cn } from "@/lib/utils";

// 세그먼트 전환 버튼 — 뉴스탭·지갑탭 등 같은 화면 안 서브탭 전환에 공용 사용
export function SegmentButton({
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

- [ ] **Step 2: 뉴스탭에서 로컬 정의 삭제 + import 추가**

`src/app/news/page.tsx`에서 112~134번 줄의 로컬 `function SegmentButton(...) { ... }` 블록 전체를 삭제한다.

상단 import에 추가(8번 줄 `import { cn } from "@/lib/utils";` 아래):
```tsx
import { SegmentButton } from "@/components/ui/SegmentButton";
```

- [ ] **Step 3: lint + build로 검증**

Run: `npx eslint src/app/news/page.tsx src/components/ui/SegmentButton.tsx && npm run build`
Expected: 성공. `cn` 미사용 경고가 뜨면(뉴스탭에서 `cn`을 다른 곳에서도 쓰는지 확인) — 뉴스탭은 `FilterChip` 등에서 `cn`을 계속 쓰므로 import 유지. 만약 빌드가 `cn` 미사용을 지적하면 뉴스탭의 `cn` import를 그대로 두되 실제 사용처를 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/ui/SegmentButton.tsx src/app/news/page.tsx
git commit -m "refactor: SegmentButton 공용 컴포넌트로 추출"
```

---

### Task 3: 지갑탭 서브탭(자산/활동/내역) 분리

`PortfolioPage`에 세그먼트 상태를 추가하고 기존 카드를 재배치한다. 총자산 요약 카드와 로그아웃 버튼은 세그먼트 밖에 유지한다.

**Files:**
- Modify: `src/app/portfolio/page.tsx`

**Interfaces:**
- Consumes: `SegmentButton` from `@/components/ui/SegmentButton` (Task 2).

- [ ] **Step 1: import + 세그먼트 상태 추가**

`src/app/portfolio/page.tsx` 상단 import에 추가:
```tsx
import { SegmentButton } from "@/components/ui/SegmentButton";
```

`PortfolioPage` 컴포넌트 본문의 기존 `useState` 아래에 추가:
```tsx
  const [tab, setTab] = useState<"assets" | "activity" | "history">("assets");
```

- [ ] **Step 2: return JSX 재구성**

기존 `return (...)`의 카드 배치를, 총자산 카드/로그아웃은 유지하고 나머지를 세그먼트별 조건부 렌더링으로 바꾼다. `return (` 전체를 아래로 교체:

```tsx
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">내 지갑</h1>

      {/* 총자산 요약 — 세그먼트 밖, 항상 표시 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {me ? `${me.nickname}님의 총자산` : <Skeleton className="h-5 w-24" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !portfolio ? (
            <Skeleton className="h-8 w-40" />
          ) : (
            <>
              <LiveTotalAssets
                cash={portfolio.cash}
                totalAssets={portfolio.totalAssets}
                className="text-2xl font-bold"
              />
              <div className="mt-2 flex justify-between text-sm text-muted-foreground">
                <span>현금 {formatMoney(portfolio.cash)}</span>
                <span
                  className={cn(totalPnl > 0 && "text-bull", totalPnl < 0 && "text-bear")}
                >
                  평가손익 {totalPnl >= 0 ? "+" : ""}
                  {formatMoney(totalPnl)}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 자산 | 활동 | 내역 세그먼트 */}
      <div className="flex gap-1 rounded-lg bg-muted p-0.5">
        <SegmentButton active={tab === "assets"} onClick={() => setTab("assets")}>
          자산
        </SegmentButton>
        <SegmentButton active={tab === "activity"} onClick={() => setTab("activity")}>
          활동
        </SegmentButton>
        <SegmentButton active={tab === "history"} onClick={() => setTab("history")}>
          내역
        </SegmentButton>
      </div>

      {/* 자산 탭 — 보유 종목 + 내 주문 */}
      {tab === "assets" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">보유 종목</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {portfolio && portfolio.holdings.length === 0 && (
                <EmptyState
                  className="py-6"
                  title="아직 보유한 주식이 없어요."
                  description="시세판에서 첫 주식을 사보세요."
                />
              )}
              {portfolio?.holdings.map((h) => (
                <HoldingRow key={h.stockCode} holding={h} />
              ))}
            </CardContent>
          </Card>

          <MyOrdersCard />
        </>
      )}

      {/* 활동 탭 — 출석 + 배지 + 방문 보너스 */}
      {tab === "activity" && (
        <>
          <AttendanceCard />

          <BadgeGrid />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">매장 방문 보너스</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                매장에 게시된 오늘의 코드를 입력하면 +1,000,000원 (1일 1회)
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="오늘의 방문 코드"
                  value={bonusCode}
                  onChange={(e) => setBonusCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && claimBonus()}
                />
                <Button onClick={claimBonus} disabled={claiming || !bonusCode.trim()}>
                  받기
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* 내역 탭 — 거래 내역 */}
      {tab === "history" && <TradeHistoryCard />}

      {/* 로그아웃 — 세그먼트 밖, 항상 표시 */}
      <Button variant="outline" onClick={logout}>
        로그아웃
      </Button>
    </div>
  );
```

- [ ] **Step 3: lint + build로 검증**

Run: `npx eslint src/app/portfolio/page.tsx && npm run build`
Expected: 성공. 미사용 import 경고 없음(모든 카드 컴포넌트가 계속 사용됨).

- [ ] **Step 4: 커밋**

```bash
git add src/app/portfolio/page.tsx
git commit -m "feat: 지갑탭 자산·활동·내역 서브탭 분리"
```

---

### Task 4: 실앱 검증 (verify 스킬)

**Files:** 없음 (검증만)

- [ ] **Step 1: verify 스킬로 실앱 구동 검증**

`verify` 스킬(dev 서버 + agent-browser)로 확인:
- 미설정 브라우저(로컬스토리지 `theme` 없음)에서 **라이트모드**로 시작하는지.
- 지갑탭에서 `자산 | 활동 | 내역` 세그먼트 전환이 동작하고, 각 탭에 올바른 카드가 보이는지(자산=보유종목·내주문 / 활동=출석·배지·방문보너스 / 내역=거래내역).
- 총자산 카드와 로그아웃 버튼이 탭과 무관하게 항상 보이는지.
- 뉴스탭 세그먼트(뉴스/토론)가 공용 컴포넌트 추출 후에도 정상 동작하는지(회귀).

- [ ] **Step 2: ROADMAP 체크박스·진행률 갱신 후 커밋** (해당 항목이 ROADMAP에 있으면)

```bash
git add docs/ROADMAP.md
git commit -m "docs: 라이트모드·지갑탭 분리 반영"
```

---

## Self-Review

**1. Spec coverage:**
- 라이트모드 기본 → Task 1 ✓
- SegmentButton 공용 추출(뉴스탭 무변) → Task 2 ✓
- 지갑탭 자산/활동/내역 분리, 총자산·로그아웃 고정, 비sticky → Task 3 ✓
- 빌드/lint/verify 검증 → 각 Task + Task 4 ✓
- 범위 밖(sticky/URL동기화/테마 마이그레이션) → 계획에 포함 안 함 ✓

**2. Placeholder scan:** 모든 코드 블록이 실제 내용 포함. TBD/TODO 없음. ✓

**3. Type consistency:** `SegmentButton` 시그니처가 Task 2 정의와 Task 3 사용처에서 일치. `tab` union `"assets" | "activity" | "history"`가 상태 정의와 세 SegmentButton `onClick`/조건에서 일관. ✓

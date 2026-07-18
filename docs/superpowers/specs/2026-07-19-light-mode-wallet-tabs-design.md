# 라이트모드 기본 + 지갑탭 서브탭 분리 설계

날짜: 2026-07-19

## 배경

UI 개선 피드백 2건:
1. 색상 모드 기본값을 다크 → **라이트**로 변경한다.
2. 지갑(`/portfolio`) 페이지가 카드 8개를 세로로 길게 나열하는 단일 스크롤이라, 뉴스탭처럼 **서브탭(세그먼트)** 으로 나눈다.

## 1. 라이트모드 기본

### 변경

- `src/components/Providers.tsx`의 `<ThemeProvider defaultTheme="dark" ...>` → `defaultTheme="light"`.
- 파일 상단 주석(색상 모드 설명)을 "라이트 기본"으로 갱신.

### 동작

- next-themes는 `localStorage`(key: `theme`)에 사용자 선택을 저장한다. `defaultTheme`은 **저장값이 없을 때만** 적용된다.
- 따라서 이미 다크/라이트를 수동 선택한 사용자는 그 값이 유지되고, 신규·미설정 사용자만 라이트로 시작한다.
- 설정 모달(`SettingsDialog`)의 수동 다크/라이트 전환 기능은 그대로 유지. `enableSystem={false}`도 유지(시스템 연동 없음).

## 2. 지갑탭 서브탭 분리

### 최종 레이아웃

```
내 지갑 (h1)
총자산 요약 카드            ← 항상 표시 (탭 위, 비고정/일반 스크롤)
[ 자산 | 활동 | 내역 ]      ← 세그먼트 바
──────────────────────────
자산:  보유 종목 · 내 주문(MyOrdersCard)
활동:  출석(AttendanceCard) · 배지(BadgeGrid) · 매장 방문 보너스
내역:  거래 내역(TradeHistoryCard)
──────────────────────────
로그아웃 버튼               ← 항상 표시 (탭 아래)
```

- 세그먼트 기본 선택: **자산**.
- 총자산 요약 카드와 로그아웃 버튼은 세그먼트 밖에서 항상 표시된다.
- 세그먼트 바는 **일반 스크롤**(sticky 고정하지 않음).

### 컴포넌트 추출: SegmentButton 공용화

현재 `SegmentButton`은 `src/app/news/page.tsx` 안에 로컬 정의돼 있다. 지갑에서 같은 UI를 쓰므로 중복을 피하려 공용 컴포넌트로 추출한다.

- 새 파일: `src/components/ui/SegmentButton.tsx` — 뉴스탭의 기존 `SegmentButton` 구현을 그대로 옮기고 export.
- 뉴스탭(`news/page.tsx`)은 로컬 정의를 삭제하고 공용 컴포넌트를 import. **동작·스타일 변화 없음**(순수 이동).
- 지갑(`portfolio/page.tsx`)도 같은 컴포넌트를 import.

### PortfolioPage 변경

- `useState<"assets" | "activity" | "history">("assets")` 추가.
- 세그먼트 바 렌더링(뉴스탭 `bg-muted p-0.5 rounded-lg` 스타일 재사용).
- 기존 카드들을 세그먼트별 조건부 렌더링으로 재배치. **카드 컴포넌트 자체(MyOrdersCard/AttendanceCard/BadgeGrid/TradeHistoryCard/방문보너스 카드)는 수정하지 않고 배치만 이동**.
- 총자산 요약 카드 + 로그아웃 버튼은 조건부 밖에 유지.

### 의존성·데이터

- 데이터 페칭 로직(`me`, `portfolio` 쿼리, `claimBonus`, `logout`)은 그대로. 탭 전환은 순수 클라이언트 상태이므로 추가 요청 없음.
- 각 카드는 이미 독립적으로 자기 데이터를 관리하거나 부모 상태를 props로 받으므로, 조건부 렌더링돼도 문제 없음(보유종목·방문보너스는 부모 상태 사용 → 조건부 렌더 시에도 부모에 유지됨).

## 테스트 / 검증

- `npm run build` + `npm run lint` 통과.
- `verify` 스킬(dev 서버 + agent-browser)로 실제 앱 검증:
  - 미설정 상태에서 라이트모드로 시작하는지.
  - 지갑탭에서 자산/활동/내역 세그먼트 전환이 정상 동작하고, 각 탭에 올바른 카드가 보이는지.
  - 뉴스탭 세그먼트(뉴스/토론)가 공용 컴포넌트 추출 후에도 그대로 동작하는지(회귀 확인).

## 범위 밖 (YAGNI)

- 세그먼트 sticky 고정, URL 쿼리 동기화, 탭 상태 영속화 — 하지 않음.
- 배지·출석 등 카드 내부 로직 변경 — 하지 않음.
- 기존 사용자의 저장된 테마 마이그레이션 — 하지 않음(그대로 존중).

@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

대구 동성로 요괴 컨셉카페 "나라카"의 8월 이벤트용 **모의 주식 거래 웹 서비스**.
손님들이 한 달간(2026-08-01 ~ 08-31) 가상 화폐로 요괴 테마 주식 8종을 거래하고, 최종 총자산 순위 3~4명이 상품을 받는다.

- 기획: `docs/PRD.md` (게임 규칙·가격 엔진·뉴스 시스템 전체 명세)
- 작업 순서: `docs/ROADMAP.md` (Phase 0~7, Task 체크리스트)

## 주요 명령어

```bash
npm run dev    # 개발 서버 (localhost:3000)
npm run build  # 프로덕션 빌드
npm run lint   # ESLint 검사
```

## 기술 스택

| 분류 | 기술 |
|------|------|
| 프레임워크 | Next.js 16 (App Router) + React 19 — SSR/API routes 사용 (**정적 export 아님**) |
| 언어 | TypeScript 5 (strict) |
| 스타일링 | TailwindCSS v4 + shadcn/ui, 다크 테마 기본 |
| 서버 상태 | TanStack Query v5 (5분 틱 폴링) |
| 클라이언트 상태 | Zustand v5 (UI 상태만) |
| 폼/검증 | React Hook Form v7 + Zod v4 |
| DB/인증 | Supabase (Postgres + RLS) |
| 배치 | Supabase pg_cron (일일 배치 22:00, 장중 크론 없음) |
| 배포 | Vercel |

## 아키텍처 핵심 원칙 (위반 금지)

1. **모든 돈 계산은 서버에서** — 매수/매도는 Postgres 함수 단일 트랜잭션 (잔고 검증 → 현재 틱 가격 체결 → 기록). 클라이언트가 보내는 가격·잔고는 절대 신뢰하지 않는다. 상품이 걸린 이벤트라 조작 방지가 곧 공정성이다.
2. **가격은 사전 생성 경로** — 매일 22:00 배치가 익일 84틱(15:00~22:00, 5분 간격)을 전부 생성해 `daily_ticks`에 저장. 장중에는 읽기만 한다. 현재가 = 현재 시각의 틱 인덱스 값.
3. **자산은 정수(냥)** — 부동소수점 금지.
4. **프론트 보간 연출은 표시용** — 틱 사이 가격 애니메이션은 눈속임일 뿐, 체결가는 항상 서버 틱 값.

## 게임 핵심 규칙 (요약)

- 장 시간: 매일 15:00~22:00 KST / 상하한: 전일 종가 ±30% / 시장가 주문만 / 매도 수수료 0.3%
- 초기 자금 1,000,000냥 고정, 매장 방문 보너스 +100,000냥 (1일 1회, 날짜별 코드)
- 가입: 매장 발급 1회용 코드 + 닉네임 + 비밀번호 (이메일 없음)
- 뉴스 3등급: 공시(100%)/정식뉴스(90%)/찌라시(55%) — 일일 배치가 익일 편향 추첨 결과로 자동 생성

## 코딩 컨벤션

- TypeScript strict — any 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트
- Server Components 우선, 필요한 경우만 `"use client"`
- 임포트: 개별 임포트 (lucide-react 포함), 경로 alias `@/*` → `./src/*`
- 변수/함수 camelCase, 컴포넌트 PascalCase, 파일: 컴포넌트 PascalCase / 유틸 camelCase
- 코드 주석·커밋 메시지·문서: 한국어
- API 응답: `ApiResponse<T>` 래퍼 일관 사용, 에러 핸들링 필수

## 커밋 규칙

- 형식: `type: 한국어 설명` (feat, fix, refactor, style, docs, test, chore)

## 개발 워크플로우

1. `docs/ROADMAP.md`에서 현재 Task 확인
2. 구현 → `npm run build` + `npm run lint` 통과 확인
3. 커밋 후 ROADMAP 체크박스·진행률 갱신

---
name: verify
description: naraka-stock 변경 사항을 실제 앱 구동으로 검증하는 레시피 (dev 서버 + Playwright)
---

# naraka-stock 검증 레시피

## 전제
- 로컬 Supabase가 떠 있어야 함: `docker ps | grep supabase_db_naraka-stock` (없으면 `npx supabase start`)
- 로컬 DB는 보통 비어 있음 — 테스트 유저는 직접 심는다:
  ```bash
  # 비밀번호 해시 생성 (프로젝트 루트, bcryptjs 사용)
  node -e "require('bcryptjs').hash('비번',10).then(console.log)"
  docker exec supabase_db_naraka-stock psql -U postgres -d postgres \
    -c "insert into users (nickname, password_hash) values ('닉네임', '해시') returning id;"
  # SQL 안에서 \$2b\$... 달러 기호는 셸 이스케이프 필요
  ```

## 실행
- dev 서버: `npm run dev` 백그라운드 + PID 저장, `curl localhost:3000/login`이 200일 때까지 대기 (~10초)
- 브라우저: Playwright chromium은 `~/Library/Caches/ms-playwright`에 이미 설치됨.
  프로젝트에는 playwright 미설치 — 스크래치패드에 `npm init -y && npm install playwright` 후 스크립트 실행
- 뷰포트 420×800 (모바일 우선 UI)

## 주요 셀렉터/흐름
- 로그인: `/login`, `#nickname`, `#password`, 버튼 role "로그인"
- 로그인 성공 → `/`로 이동, 헤더 우측 버튼이 "로그아웃"으로 바뀜 (TanStack Query ["me"])
- 에러는 sonner 토스트: `[data-sonner-toast]`
- 한글 IME 유사 입력은 `pressSequentially`로 한글 문자열을 직접 타이핑 (fill도 onChange 변환을 태움)

## 정리 (좀비 방지)
- dev 서버 kill + `pkill -f "next dev"` sweep
- 심은 테스트 유저 delete

---
name: verify
description: naraka-stock 변경 사항을 실제 앱 구동으로 검증하는 레시피 (dev 서버 + agent-browser)
---

# naraka-stock 검증 레시피

브라우저 자동화는 [agent-browser](https://github.com/vercel-labs/agent-browser) CLI를 사용한다.
글로벌 설치됨(`agent-browser --version`). 미설치면 `npm i -g agent-browser && agent-browser install`.
사용법이 헷갈리면 `agent-browser skills get core --full`로 레퍼런스를 먼저 로드한다.

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
- 브라우저는 별도 설치·스크립트 불필요 — `agent-browser` 명령을 Bash로 직접 호출한다.
- 세션은 명령 간 유지된다(같은 브라우저). 뷰포트는 open 직후 `agent-browser set viewport 420 800` (모바일 우선 UI)

## 핵심 루프
```bash
agent-browser open http://localhost:3000/login   # 1. 페이지 열기
agent-browser set viewport 420 800               # 2. 모바일 뷰포트
agent-browser snapshot -i                         # 3. 상호작용 요소 + ref(@eN) 확인
agent-browser click @e3                           # 4. snapshot의 ref로 조작
agent-browser snapshot -i                         # 5. 페이지 변화 후 반드시 재-snapshot
```
ref(`@e1`…)는 snapshot마다 새로 매겨지고, 페이지가 바뀌면 즉시 stale 된다. ref 조작 전엔 항상 재-snapshot.
안정적인 셀렉터(`#nickname` 등)가 있으면 snapshot 없이 CSS/시맨틱 로케이터를 바로 써도 된다.

## 주요 셀렉터/흐름
- 로그인: `/login`, `#nickname`, `#password`, 로그인 버튼
  ```bash
  agent-browser fill "#nickname" "닉네임"
  agent-browser fill "#password" "비번"
  agent-browser find role button click --name "로그인"
  # 또는 snapshot -i 후 버튼 @ref click
  ```
- 로그인 성공 → `/`로 이동, 헤더 우측 버튼이 "로그아웃"으로 바뀜 (TanStack Query ["me"])
  ```bash
  agent-browser wait --text "로그아웃"          # 성공 판정
  agent-browser get url                          # "/"로 이동 확인
  ```
- 에러는 sonner 토스트: `agent-browser wait "[data-sonner-toast]"` → `agent-browser get text "[data-sonner-toast]"`
- 한글 입력: `fill`/`type` 모두 실제 키 이벤트를 태우므로 입력값 onChange 한글 변환이 정상 동작한다
  (`fill`은 기존 값 clear 후 입력, `type`은 clear 없이 이어서 입력)
- 화면 확인용 캡처: `agent-browser screenshot shot.png` (전체 스크롤 높이는 `--full`,
  ref 라벨 오버레이는 `--annotate`)

## 정리 (좀비 방지)
- 브라우저: `agent-browser close --all`
- dev 서버 kill + `pkill -f "next dev"` sweep
- 심은 테스트 유저 delete

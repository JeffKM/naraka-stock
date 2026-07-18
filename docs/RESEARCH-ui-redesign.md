# UI 개선 리서치 & 구현 로드맵 — 아기자기 지옥 × 토스식 증권 × 소셜 피드

> 작성 2026-07-18. 방식: deep-research(외부 레퍼런스 3축) + 현재 코드베이스 진단 결합.
> 목표: 나라카 컨셉카페만의 "아기자기한 지옥" 감성을 살리면서, 토스증권식 거래 UX의 신뢰·가독성과 공존시키고, 뉴스·토론을 인스타/트위터식 소셜 피드로 고도화하며, 운영자 UX의 세로 나열 문제를 해결한다.

---

## 0. 결정 사항 (사장님 확정)

| 항목 | 결정 |
|------|------|
| 작업 방식 | 세 축 전체를 묶은 **단계별(Phase) 로드맵을 먼저 문서로 확정**한 뒤 순차 구현 |
| 어드민 레이아웃 | **현 `max-w-lg` 1컬럼 유지** + 각 섹션 리스트에 스크롤 영역/그리드/ sticky 액션바만 도입 (어드민 전용 넓은 2패널 레이아웃은 채택 안 함 — 모바일에서도 운영 가능해야 하므로) |

---

## 1. 현재 나라카 UI 구조 진단 (코드 근거)

### 1.1 전역 레이아웃 — 컨테이너가 단 하나
- `src/app/layout.tsx:55` — `<main className="mx-auto w-full max-w-lg flex-1 px-4 pb-24 pt-4">`.
- **손님 화면·운영자 콘솔이 전부 이 `max-w-lg`(512px) 모바일 1컬럼**에 들어간다. 데스크톱에서도 좁은 중앙 칼럼.
- route group은 `(auth)` 하나뿐. `(marketing)`/`(app)` 없음. 각 폴더 `layout.tsx`는 `metadata`만 지정하고 `return children`.
- 반응형은 사실상 **모바일 온리** — `sm:`/`md:` 브레이크포인트가 거의 없음(유일한 예외 `StickerSection.tsx:122` `sm:grid-cols-3`).

**해석**: 손님 화면엔 1컬럼이 정석(토스도 동일). 문제는 어드민이 같은 폭에 갇힌 점, 그리고 손님 화면이 "위계 설계" 없이 카드만 세로로 쌓여 스캔성이 떨어지는 점.

### 1.2 손님 화면
모두 공통 `max-w-lg` 상속 + 페이지 루트 `flex flex-col gap-4`.
- 홈/시세판 `src/app/page.tsx:161` — `IndexCards → AssetSummaryCard → PopularStocks → 전체/관심 탭+정렬 → 전종목 리스트(`page.tsx:226`, `divide-y`) → NewsHighlight`. 한 줄 = `QuoteRow`(`page.tsx:64`).
- 종목 상세 `src/app/stocks/[code]/page.tsx:68` — 헤더 → `StockChart` → `MyHoldingCard` → `TradePanel` → `MyOrdersCard` → `StockStats` → 관련 뉴스 → `StockComments`.
- 지갑 `src/app/portfolio/page.tsx:102`, 그 외 support/history/guide 동일 세로 스택.

### 1.3 뉴스/토론 — 이미 소셜 피드 골격 있음 ✅
- 뉴스 `src/app/news/page.tsx` — 상단 `sticky top-14` 세그먼트(뉴스/토론) + 종목 필터 칩 가로 스크롤. 카드 1건 = `NewsList.tsx:178` `<article>` (아바타/매체로고·인증뱃지·핸들·날짜·제목·본문·캐시태그). **엄지업/다운 토글**(`:263-296`). 등급 3종 아바타 분기 `GRADE_META`(`:36`). `compact` 모드는 종목 상세 "관련 뉴스"용 얇은 행.
- 토론 = 두 군데:
  - 종목별 토론방(작성 가능) `src/components/trade/StockComments.tsx:135` — 스티커 피커+입력, 댓글 **단일 레벨** `divide-y`(`:177`), 스티커 이미지 `size-24`, 엄지업, 본인/어드민 수정·삭제. 10초 폴링.
  - 전종목 토론 모아보기(읽기 전용) `src/components/news/DiscussionList.tsx:40` — 카드 리스트, 엄지업만. 15초 폴링.

**해석**: 소셜 피드는 "신규 구축"이 아니라 **고도화** 대상. 반응 바 금융특화·댓글 중첩·스티커 리액션이 빠져 있음.

### 1.4 어드민 — "세로 나열로 버튼 밀림"의 진원지
- 진입 `src/app/admin/page.tsx:50`, 탭 5개: 현황/운영/유저/관리/문의.
- **`src/components/admin/StockSection.tsx:80`** — `filtered.map()`으로 **전 종목(~42종)을 스크롤·그리드 없이 한 줄씩 전부 렌더**. `max-h`/`overflow-y` 없음. 리스트 **바로 아래**에 `<ListingForm />`(`:126`, "상장하기" 버튼 `:393`)이 붙어 42줄 전체 밑으로 밀림. 게다가 이 카드가 "관리" 탭에서 스티커/이벤트/뉴스/리셋 섹션 전체를 아래로 밀어냄.
- `admin/` **전체에 `max-h`/`overflow-y`/`overflow-auto`가 하나도 없음**. `UserSection.tsx:49`, `SectorSection.tsx:96`도 동일한 무한 세로 나열.

---

## 2. 외부 레퍼런스 리서치 요약

### 2.1 토스식 모바일 증권 UX (토스·카카오페이·슈퍼SOL)
사실상 업계 표준이 된 패턴:
- **종목 리스트 정보 위계**: 종목명 좌측 정렬 / 현재가·등락률 우측 정렬(숫자 기둥) / 타이포 스케일 3단계 이상으로 KPI 강조 / 상승 빨강·하락 파랑 + 스파크라인 색 일치 → "빨간 줄 많은지" 한눈에 스캔. 숫자 압축 표기(1.2조, 3,450만).
- **종목 상세**: 상단 요약(종목명·현재가·등락률 크게 고정) → 차트(기간 탭·캔들/라인 전환·오버레이는 점진 공개) → 하단 큰 매수 버튼(누르면 간편/호가 분기) → 정보·차트·호가·보유·주문 **탭 구조**로 세로 스크롤 축소.
- **홈 자산 카드**: 총액 → 손익 → 비중 게이지 → 변화 추세, 사용자 사고 흐름대로 위에서 아래.
- **세로 스크롤 지루함 방지**: 상단/하단 sticky 요소로 맥락 유지 / 섹션 헤더·요약 위젯(Top100 등)으로 리듬 / 상단 고정 필터·검색 / 정보 점진 공개(더보기·접기).
- **몰입**: AI 시그널("가격이 왜 움직였나" 한 문장 설명형 UX), 친근한 마이크로카피(~해요체), 게이미피케이션은 건전 습관 강화 방향(랜덤박스·연속 기록).
- 출처: toss.tech/article/uxresearcher-meets-investor, developers-apps-in-toss.toss.im/design/consumer-ux-guide, mk.co.kr/news/stock/11125656, yozm.wishket.com/magazine/detail/919, hankyung.com(AI 시그널).

### 2.2 인스타/트위터/스레드식 소셜 피드
- **카드 = 상단 메타(아바타·작성자·타임스탬프·더보기) + 본문(텍스트·해시태그·티커·링크) + 미디어 + 하단 반응 바**. 각 카드가 "상호작용 허브"의 게이트웨이.
- **인게이지먼트 위계**: 좋아요=감정·즉각(하트 채움+튀어오름 애니메이션), 댓글=참여, 공유=확산. Threads는 오른손 엄지 도달성 위해 반응 바를 우하단으로. 부정/관리 액션(신고·뮤트)은 상단 더보기에 숨김.
- **댓글 중첩 스레드**: 상위 댓글 아래 대댓글 들여쓰기 + 연결선, "답글 N개 더 보기" 접기/펼치기, 입력창에 "@작성자에게 답글" 컨텍스트(Re:amaze Nested Threads, YouTube).
- **이모지/스티커 리액션**: Slack/Discord식 집계 버블(같은 이모지 재탭 시 제거, 참여자 하이라이트), 인스타 스토리 퀵 이모지, Discord 슈퍼 리액션(강조 애니메이션).
- **금융 특화 재매핑**: 좋아요→"유익함", 뉴스 하단에 **호재/악재 투표 + 집계 막대(미니 여론조사)**, 토론에 Bullish/Bearish 라벨, 루머엔 "검증되지 않음" 컨텍스트 배지(X 커뮤니티 노트).
- **피드 메커니즘**: 인피니트 스크롤(소셜엔 적합) + 세그먼트 탭(For you/Following) + 뉴스는 하이브리드(최근은 무한, 과거는 날짜별 페이지네이션).
- 출처: figma instagram/threads UI, help.x.com(timeline·conversations·community-notes), slack.com/help emoji-reactions, support.discord.com reactions, nngroup.com infinite-scrolling-tips, robinhood.com from-news-to-newsfeed, webull community.

### 2.3 아기자기 지옥(cozy horror) × 데이터 헤비 어드민
- **cozy horror 아트 디렉션**(Cozy Grove, Night in the Woods, Luigi's Mansion 3): 세계관은 어둡지만 UI 레이어는 손그림·라운드·밝은 포인트 컬러로 안전·친근·유머. 마스코트는 공포를 중화하는 정서 에이전트(눈 크게·이빨 최소·둥근 형태). 부드러운 easing 전환, 점프 스케어 지양.
- **감성 × 금융의 공존 = 레이어 분리**(Toptal Fintech UX, Eleken, Tubik):
  - **기능 레이어**(숫자·차트·거래·데이터)는 담백하게 — 단순 산세리프/모노, WCAG 대비, 색은 의미 전달만, 통일된 그리드.
  - **장식 레이어**(마스코트·손그림·배경·포인트 컬러)는 온보딩·빈 상태·알림·축하에 집중, 데이터 밀집 화면에선 축소. 디자인 토큰을 "장식/기능"으로 분리 정의.
  - 마스코트는 **기능 요소를 가리지 않는 위치**에서 시선만 유도.
- **다크모드 접근성**(Stephanie Walter): 다크가 항상 접근성 우위는 아님(난시 halo). 라이트/다크 선택 제공, 포커스 인디케이터 대비 확보, 본문·숫자 굵은 폰트 남용 주의.
- **데이터 헤비 어드민 패턴**: 마스터-디테일 2패널 / 좌측 사이드 내비 / **상단 고정 툴바·하단 sticky 액션바** / 데이터 테이블 **행별 인라인 액션** / 탭·아코디언 섹션 분리 / **검색·필터 상단 우선** / 리스트 스크롤 영역화. 히트 영역은 렌더보다 넓게(pow.rs 3 layers).
- 출처: gameuidatabase.com(Cozy Grove·NITW·Luigi's Mansion 3), toptal.com mastering-fintech-ux·aesthetics-vs-functionality, eleken.co cases·trusted-fintech-ui, tubikstudio.com visual-dividers·mascot-design, stephaniewalter.design dark-mode-accessibility-myth, knowledge.workspace.google.com admin navigate, pow.rs 3-layers-of-ui-interaction.

---

## 3. 설계 원칙 (전 작업 공통 규범)

1. **레이어 분리** — 장식(요괴·손그림·포인트·배경)은 기능(숫자·차트·거래 버튼) 위에 겹치지 않는다. 데이터는 담백하게. 디자인 토큰을 장식/기능으로 나눠 관리.
2. **토스식 위계** — 종목/자산 숫자는 우측 정렬 기둥 + 타이포 스케일 + 상승/하락 색 일관 + 스파크라인. 레이아웃을 넓히기보다 위계로 스캔성을 해결.
3. **소셜 피드는 고도화** — 기존 `NewsList`/`StockComments`/`DiscussionList` 골격 유지하고 반응 바·중첩 댓글·리액션만 얹는다.
4. **어드민은 1컬럼 유지** — 폭을 넓히지 않고, 리스트 스크롤 영역화 + 그리드 + sticky 액션바 + 검색/필터 상단화로 "버튼 밀림"을 없앤다.
5. **PRD 원칙 불가침** — 모든 돈 계산은 서버, 프론트 연출은 표시용, 이모지는 UI 문구에 넣지 않음(기존 확정 선호), 나라카 세계관 캐논/금지 어휘 준수.
6. **접근성** — 다크 대비, 포커스 인디케이터, 히트 영역 ≥40dp.

---

## 4. 구현 로드맵 (Phase)

> 각 Phase는 독립 배포 가능하도록 슬라이스. 순서는 "효용 대비 리스크"로 정렬 — 운영 고통(어드민)과 손님 스캔성(홈 위계)을 앞에, 감성 레이어·소셜 고도화를 뒤에.

### Phase A — 어드민 세로 나열 해소 (운영 고통 즉시 완화)
**방향: 현 1컬럼 유지, 스크롤/그리드/ sticky 액션바만.**
- `StockSection.tsx` — ① 종목 리스트를 `max-h-[N] overflow-y-auto` 스크롤 영역으로. ② 상단에 검색/섹터 필터를 sticky로. ③ "신규 상장"(`ListingForm`)을 리스트 **위**로 옮기거나 `StockDialog`처럼 다이얼로그화 → 42줄 아래로 안 밀림. ④ 여유되면 `sm:grid-cols-2` 그리드.
- `UserSection.tsx:49`, `SectorSection.tsx:96` — 동일하게 스크롤 영역 + 상단 검색.
- `admin/page.tsx` — "관리" 탭 내부가 여전히 길면 아코디언/서브탭으로 섹션 접기.
- 검증: `npm run build` + `npm run lint` + verify 스킬(agent-browser)로 /admin 실화면.

### Phase B — 손님 시세 위계 개편 (토스식, 레이아웃 폭 불변)
- `QuoteRow`(`page.tsx:64`)·전종목 리스트 — 우측 정렬 숫자 기둥 정돈, 타이포 스케일로 현재가/등락률 강조, **스파크라인(미니 차트)** 추가, 상승/하락 색을 숫자+스파크라인 동일 적용.
- 홈 `AssetSummaryCard` — 총액→손익→비중→추세 위계 재정렬.
- 섹션 헤더·요약 위젯으로 스크롤 리듬(인기/관심/전종목 구분 강화), 상단 정렬·필터 sticky.
- 종목 상세 — 상단 요약 고정 + (옵션) 정보/차트/보유/토론 탭 구조 검토로 세로 스크롤 축소.

### Phase C — 아기자기 지옥 감성 레이어 (장식 레이어 한정)
- **배경 = 하이브리드 확정 (2026-07-19, 무드 "보라밤")**. 현 `MarketGridBackdrop`(그리드+시세잔상) 유지 위에 지옥 레이어(불씨+안개) 추가. 인터랙티브 시안으로 5무드 비교 후 **보라밤** 선택.
  - 확정 토큰: `--bg: oklch(0.185 0.04 315)` / 불씨(ember) `rgb(214,150,255)`·코어 `rgb(240,214,255)` / 안개 `fog-a rgb(168,104,206)`·`fog-b rgb(120,80,168)`.
  - 강도 기본값: **불씨 밀도 70 / 안개 강도 15**.
  - 불씨 = canvas **발광(globalCompositeOperation="lighter") 블렌드**(다크 위 묻힘 방지), 아래→위 부유. 안개 = 하단 radial 3블롭 `mix-blend-mode:screen`.
  - **중앙 dim / 사이드 살림 마스크**: 콘텐츠 512px 밴드 뒤는 지옥레이어 감쇠(가독성), 데스크톱 빈 사이드에서 살아남 → "허전한 사이드" 동시 해결. 모바일(풀폭)은 전역 잠잠.
  - 이식 주의: SSR/hydration(현 서버컴포넌트 deterministic 유지), `prefers-reduced-motion`에서 부유 정지, canvas DPR≤2 성능.
- 디자인 토큰을 **장식/기능**으로 분리 정의(색·폰트·라운드·그림자).
- 요괴 마스코트를 **빈 상태·온보딩·거래 완료 축하·방문보너스**에 배치(데이터 카드 위 겹침 금지).
- 손그림 일러스트·포인트 컬러(다크 배경 + 절제된 따뜻한 포인트), 부드러운 easing 전환.
- 나라카식 설명형 시그널(토스 AI 시그널의 세계관 버전) — 요괴가 "이 종목이 왜 움직였나" 한 문장. ※ 데이터 정합성은 서버 기준.
- 다크모드 접근성 점검(대비·포커스).

### Phase D — 소셜 피드 고도화 (뉴스/토론)
- 뉴스 카드 하단 반응 바 — 엄지업/다운 + **호재/악재 투표 + 집계 막대**.
- `StockComments` — **댓글 중첩 스레드(2~3레벨 제한)** + "@작성자에게 답글" 컨텍스트 + "답글 N개 더 보기" 접기/펼치기.
- 스티커를 **Slack/Discord식 집계 리액션**으로도 사용(현 첨부 방식과 병행).
- 루머 등급에 "검증되지 않음" 컨텍스트 배지 강화(기존 `GRADE_META` 확장).
- 반응 바 우하단 정렬(오른손 엄지 도달성), 히트 영역 확보.

---

## 5. 열린 질문 (구현 착수 전 확정 필요)
- Phase B 스파크라인 데이터: 기존 `daily_ticks`에서 경량 계열을 뽑을지, 별도 요약 컬럼을 둘지 (PostgREST 1000행 페이지네이션 이슈 고려 — 기존 교훈 참조).
- 종목 상세 "탭 구조" 전환 여부(세로 스택 유지 vs 탭) — 컨텐츠 양 보고 결정.
- 마스코트 에셋: 기존 세계관 캐논 캐릭터를 손그림화할지, 신규 제작할지.
- Phase D 호재/악재 투표의 서버 스키마(집계 테이블) 필요 여부.

---

## 부록: 우선 착수 파일
1. `src/components/admin/StockSection.tsx:80` (Phase A 핵심)
2. `src/components/admin/UserSection.tsx:49`, `SectorSection.tsx:96` (Phase A)
3. `src/app/page.tsx:64` `QuoteRow` (Phase B)
4. `src/components/news/NewsList.tsx:263`, `src/components/trade/StockComments.tsx:177` (Phase D)
5. `src/app/layout.tsx:55` — 이번엔 **건드리지 않음**(1컬럼 유지 결정).

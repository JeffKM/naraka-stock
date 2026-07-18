# 마스코트 "보밤이" 통합 설계 (Phase C — 감성 레이어)

> 확정 2026-07-19. 브랜치 worktree-feat+ui-tweaks. 배경(보라밤) 슬라이스(커밋 c619200)에 이은 Phase C 두 번째 슬라이스.

## 배경

Phase C의 "요괴 마스코트를 빈 상태·온보딩·거래완료·방문보너스에 배치" 항목 구현. 세계관 캐논은 4캐릭터(옥자·미호·멜·바나)+펫으로 고정이고 신규 인물 창조를 금지하나, 사장님(오너) 승인으로 **앱 전용 마스코트 신규 캐릭터를 캐논 확장**하기로 결정.

## 캐릭터 — 보밤이

- 정체: "보라밤의 잔불에서 깨어난 복슬한 잔불 요괴." 방금 도입한 보라밤 배경(불씨)과 색·설정으로 결속.
- 외형: 중간톤 자두빛(plum-violet) 복슬 몸 + 크림/베이지 배 + 동공 있는 큰 눈 + 볼터치. **순검정 금지** — 중간톤이라 다크(보라밤)·라이트(한지 크림) 양쪽에서 실루엣이 살아남는다.
- 포지션: 나라카 4캐릭터·펫과 별개인 **앱 안내자/마스코트**. 장식 레이어 전용(데이터 카드 위 겹침 금지).
- 에셋 제작: higgsfield/nano_banana 생성 → 레퍼런스 기반 편집으로 포즈 일관성 확보 → PIL flood-fill 누끼(최대 변 448px, 가장 큰 연결요소만 남겨 흩어진 색종이 제거).

## 호스트 전략

상시 얼굴은 보밤이 한 명(각인·일관성·저부담). 나라카 4캐릭터는 향후 특별 순간 카메오로만(이번 슬라이스 범위 밖).

## 에셋

`public/mascot/` 투명 PNG 3종:
- `bobam-idle.png` — 기본. 빈 상태·온보딩.
- `bobam-cheer.png` — 만세. 거래완료 축하.
- `bobam-wave.png` — 손 흔들기. 환영·보너스.

## 컴포넌트

- `src/components/mascot/Mascot.tsx` — `<Mascot pose size className>`. next/image 래퍼, 정사각 프레임 object-contain, `aria-hidden`(순수 장식).
- `src/components/mascot/EmptyState.tsx` — `<EmptyState pose mascotSize title description action>`. 마스코트 + 한 줄 카피 + 선택 CTA. 빈 상태 공용.

## 배치 (6곳)

| 위치 | 파일 | 포즈 | 카피 |
|------|------|------|------|
| 관심종목 빈 상태 | `app/page.tsx` | idle / wave(비로그인) | "아직 점찍어둔 종목이 없어요. 별을 눌러…" |
| 보유 종목 없음 | `app/portfolio/page.tsx` | idle | "아직 보유한 주식이 없어요." |
| 거래내역 없음 | `components/portfolio/TradeHistoryCard.tsx` | idle | "아직 거래 기록이 없어요." |
| 댓글 없음 | `components/trade/StockComments.tsx` | idle | "아직 댓글이 없어요." |
| 거래완료 축하 | `components/trade/TradeSuccessOverlay.tsx` | cheer | 기존 체크+폭죽 위에 등장 |
| 출석 보너스 | `components/portfolio/AttendanceCard.tsx` | wave | "오늘도 와줬네요!…" |
| 온보딩 환영 | `app/(auth)/signup/page.tsx` | wave | "나라카에 온 걸 환영해요" |

카피는 세계관 말투·이모지 없음([[no-emoji-in-ui]]) 준수.

## 원칙 준수

- 장식/기능 레이어 분리 — 마스코트는 빈 공간·축하·안내에만, 숫자·차트 위 겹침 금지.
- 다크/라이트 겸용 — 중간톤 자두색 + 아웃라인으로 양쪽 검증 완료.

## 검증

build/lint 통과. verify(agent-browser)로 signup 환영·지갑(보유/출석)·홈 관심탭 빈 상태를 다크/라이트 양쪽 실화면 확인. 거래완료 cheer는 동일 컴포넌트라 안전(장 마감으로 실거래 트리거는 리허설 셋업 필요 — 미실행).

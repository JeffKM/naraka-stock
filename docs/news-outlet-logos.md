# 뉴스사 로고 생성 프롬프트 (Gemini / 이미지 생성용)

나라카 "소식통" 피드의 정식 뉴스 매체 7종 로고를 생성하기 위한 프롬프트 모음.
각 로고는 뉴스 카드에서 **원형 아바타(약 40×40px)** 로 표시되므로, 작게 줄여도
알아볼 수 있는 **단순한 엠블럼/모노그램** 형태여야 한다.

## 공통 컨셉 (모든 프롬프트에 공유)

- 세계관: 대구 동성로 요괴 컨셉카페 "나라카(奈落, 지옥)". 디자인 톤은 **"아기자기한 지옥"** —
  으스스하지만 귀엽고 장난기 있는 다크 판타지.
- 용도: 다크 테마 앱의 **원형 뉴스사 배지**. 배경은 어둡다.
- 스타일: **플랫 벡터 로고, 미니멀, 좌우대칭 엠블럼**, 굵은 실루엣, 그라데이션·잔디테일 최소.
- 형식: **정사각 1:1, 투명 배경(PNG)**, 중앙 정렬, 여백 균일. 실사·사진·텍스트 문장 금지.
  글자를 넣더라도 **한 글자 모노그램 또는 심볼**까지만.
- 색: 매체별로 아래 지정색을 주조색으로. 다크 배경에서 대비가 살도록 채도·명도 확보.

> 아래 프롬프트는 영어로 작성(이미지 모델이 더 안정적). 각 항목의 한글 설명은 참고용.

---

## 1. 나라카 데일리 (slug: `daily`) — 종합 일간지, 신뢰감

주조색: 앰버/골드 `#F5B841`

```
Flat vector emblem logo for a fictional daily newspaper called "Naraka Daily".
A simple bold monogram "N" fused with a rising-sun-over-horizon mark, evoking a
morning broadsheet. Cute-spooky dark-fantasy tone but clean and trustworthy.
Amber-gold (#F5B841) on transparent background. Symmetrical, minimal, high contrast,
readable at 40px. Centered, even padding, 1:1 square, no photorealism, no sentence text.
```

## 2. 나라카경제 (slug: `biz`) — 경제 전문지, 차분·묵직

주조색: 에메랄드 `#34D399`

```
Flat vector emblem logo for a fictional business & finance newspaper "Naraka Biz".
A minimal upward candlestick/bar-chart mark merged with a bold "N". Serious,
money-and-markets feel with a subtle mischievous yokai twist. Emerald green (#34D399)
on transparent background. Symmetrical, minimal, high contrast, readable at 40px.
Centered, 1:1 square, no photorealism, no sentence text.
```

## 3. 나라카 저널 (slug: `journal`) — 시사·탐사, 지적

주조색: 인디고/바이올렛 `#8B7CF6`

```
Flat vector emblem logo for a fictional investigative journal "Naraka Journal".
A minimal quill pen or open-book mark forming the letter "J", intellectual and sharp,
with a faint eerie dark-fantasy vibe. Indigo-violet (#8B7CF6) on transparent background.
Symmetrical, minimal, bold silhouette, readable at 40px. Centered, 1:1 square,
no photorealism, no sentence text.
```

## 4. 나라카 헤럴드 (slug: `herald`) — 속보·선포, 힘있는

주조색: 크림슨/레드 `#F0574B`

```
Flat vector emblem logo for a fictional herald newspaper "Naraka Herald".
A minimal herald's trumpet / banner mark forming an "H", bold and announcing,
playful-hellish dark-fantasy accent. Crimson red (#F0574B) on transparent background.
Symmetrical, minimal, strong silhouette, readable at 40px. Centered, 1:1 square,
no photorealism, no sentence text.
```

## 5. 나라카타임스 (slug: `times`) — 권위지, 클래식

주조색: 청록/틸 `#2DD4BF`

```
Flat vector emblem logo for a fictional authoritative newspaper "Naraka Times".
A minimal clock / gothic-serif "T" mark, classic and stately, with a subtle
cute-spooky yokai touch. Teal (#2DD4BF) on transparent background. Symmetrical,
minimal, high contrast, readable at 40px. Centered, 1:1 square, no photorealism,
no sentence text.
```

## 6. 나라카방송 (slug: `bc`) — 방송사, 라이브

주조색: 핫핑크/마젠타 `#EC4899`

```
Flat vector emblem logo for a fictional broadcasting network "Naraka Broadcasting".
A minimal broadcast tower / signal-waves mark combined with a bold "B", TV-live energy,
playful dark-fantasy yokai vibe. Hot pink-magenta (#EC4899) on transparent background.
Symmetrical, minimal, high contrast, readable at 40px. Centered, 1:1 square,
no photorealism, no sentence text.
```

## 7. 나라카포스트 (slug: `post`) — 대중지, 빠르고 가벼움

주조색: 스카이/시안 `#38BDF8`

```
Flat vector emblem logo for a fictional popular newspaper "Naraka Post".
A minimal paper-plane / envelope "P" mark, fast and casual tabloid energy,
cute-spooky dark-fantasy accent. Sky-cyan blue (#38BDF8) on transparent background.
Symmetrical, minimal, bold silhouette, readable at 40px. Centered, 1:1 square,
no photorealism, no sentence text.
```

---

## 생성 후 적용 방법 (참고)

1. 각 파일을 **slug 이름**으로 저장: `public/news-outlets/daily.png`, `biz.png`, `journal.png`,
   `herald.png`, `times.png`, `bc.png`, `post.png` (정사각·투명 배경 권장).
2. `src/lib/news/outlets.ts`의 `NewsOutlet` 인터페이스에 `logo` 필드를 추가하고 각 매체에 경로 지정
   (예: `logo: "/news-outlets/daily.png"`).
3. `src/components/news/NewsList.tsx`의 원형 아바타 `<div>`(약 158–166줄)에서 정식 뉴스일 때만
   `<Image>`로 로고를 렌더링하도록 분기(공시·찌라시는 기존 텍스트 배지 유지).

> 로고 이미지가 준비되면 위 2·3단계 코드 연결은 별도로 진행.

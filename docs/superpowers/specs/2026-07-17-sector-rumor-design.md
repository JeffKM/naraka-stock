# 섹터 찌라시 개편 설계 (2026-07-17)

## 배경·목표

현재 섹터 뉴스는 그날 실현된 섹터 평균 등락을 **사후 설명**하는 정식뉴스(`grade='news'`, 90%)로,
장 **80% 후반 지점**에 노출된다. `{sector}` 자리에 라벨만 치환하는 범용 문안(등급당 12개)이라
섹터 고유의 색이 없고, 사후 설명이라 "미리 읽고 베팅하는" 재미가 없다.

이를 **장 초반 찌라시(예고)**로 전환한다. 목표는 두 가지 (사장님 확정):

1. **예측 도박의 재미** — 초반에 뜬 섹터 소문을 보고 "이 섹터 오를 것 같다" 판단해 미리 베팅.
   소문은 진짜와 가짜가 섞여 있어(적중률 55~70%) 도박성이 핵심 재미.
2. **세계관 몰입** — 섹터별 고유 문안 + 세계관 찌라시꾼 제보 형식으로 나라카 색을 진하게.

밸런스 리스크(기존 조기 방향뉴스와 예측 신호가 중첩)는 감수하되, **전략 붕괴는 시뮬레이션으로 차단**한다.

## 현재 동작 (변경 대상)

- **엔진** (`src/lib/engine/bias.ts`): `drawSectorEvents`가 진짜 섹터 이벤트 0~3개(방향·`magnitude=15`)를
  뽑고, `applySectorEvents`가 구성원 각자 70% 참여확률로 개별 편향에 가산한다. **이 시세 로직은 유지한다.**
- **뉴스** (`src/lib/news/generate.ts`): `generateSectorNews`가 이벤트별 구성원 실현 평균 등락을
  `gradeSector`로 4등급화(surgeUp/up/down/plungeDown)해 `SECTOR_NEWS_TEMPLATES[grade]`에서 추첨,
  `{sector}` 치환 후 장 0.8 지점에 `grade='news'`·`stock_code=null`로 발행한다. **이 함수·템플릿을 제거·대체한다.**
- **배치** (`src/services/batchService.ts:221-244`): 실현 종가로 섹터 평균을 계산해 `generateSectorNews` 호출.
- **DB** (`apply_daily_batch`, `20260716020000_volume.sql:120`): news insert가
  `(date, stock_code, grade, title, body, is_auto, published_at)` — **`source` 미포함**(자동 뉴스는 source=null).
  재실행 필터(`108-117`)는 is_auto인 news/rumor를 함께 지우고 재삽입하며, 수동 찌라시(is_auto=false)는 보존한다.

## 변경 설계

### 1) 시세 엔진은 불변

`drawSectorEvents` → `applySectorEvents` → 경로 생성 흐름은 손대지 않는다. 실제 주가 움직임은
그대로이고 **뉴스 레이어만** 후반 설명 → 초반 예고로 바꾼다. 시드 재현성(RNG 소비 순서)도 유지된다.

### 2) 소문 추첨 — 진짜 + 가짜

새 함수 `generateSectorRumors`가 두 종류의 소문을 만든다.

- **진짜 소문**: `sectorEvents`의 각 이벤트 → 그 `direction`(1/-1 = 상승/하락)을 **그대로 예고**한다.
  실현 결과가 아니라 **이벤트의 의도된 방향**을 쓴다. 참여확률(70%)·개별 편향 상쇄 탓에 실현이
  반대가 되는 날이 있어 **자연 적중률이 이미 100% 미만** — 이것이 도박의 1차 재미다.
- **가짜 소문**: 이벤트가 없는 섹터 중 **랜덤 1~2개**를 뽑아 **랜덤 방향**으로 예고한다. 실제 공통편향이
  없어 대개 빗나가지만, 그 섹터 구성원의 개별 편향으로 우연히 맞으면 "대박"이 된다.

**하루 소문 수(출발점)**: 가짜 1~2개(균등 랜덤) + 진짜 전부(0~3, 평균 1.3) ≈ 평균 2.8개, 대체로 2~3개대.
진짜가 3개인 드문 날(15%)만 4~5개. 최종 개수·적중률은 §5 시뮬레이션으로 튜닝한다.

**방향은 2단계**(상승/하락)만. 예고라서 강도(급등/급락)는 언급하지 않는다.

**RNG 소비**: 가짜 섹터·방향 추첨은 경로 생성이 모두 끝난 뒤(뉴스 생성 구간)에서 소비하므로 시세
재현성에는 영향이 없다. `scripts/simulate.ts`가 이 소비를 따라오도록 동일 지점에서 같은 함수를 호출한다.

### 3) 노출 타이밍 — 장 초반 구간에 분산

소문 전체를 장 **0~20% 지점 창**에 흩뿌린다(개장 직후 한 틱에 몰리지 않게). 정확한 창(0.0~0.2)과
분산 방식(균등 슬롯 + 소량 지터, `generateRegularNews`의 중립 배치 패턴 참고)은 구현 시 확정하되,
초반일수록 추종 이득이 커지므로 §5 시뮬레이션에서 붕괴 시 **창을 뒤로 미루는** 여지를 남긴다.

### 4) 데이터 구조

- `grade = 'rumor'`, `stock_code = null`(섹터/시장 전체 소문 표식 유지), `is_auto = true`(재실행 시 교체).
- **`source`** = 세계관 찌라시꾼 이름(§6). `GeneratedNews`에 `source?: string | null` 필드를 추가하고,
  배치 → `apply_daily_batch`가 이를 insert하도록 **DB 마이그레이션**으로 news insert에 `source` 컬럼을 추가한다
  (`jsonb_to_recordset` 파싱 + `insert ... (…, source, …)`). 기존 자동 뉴스(공시·정식)는 source=null 유지.
- 재실행 삭제 필터는 그대로 동작한다(자동 rumor가 news/rumor 그룹에 포함). 수동 찌라시(is_auto=false)는 보존.

### 5) 밸런스 검증 (시뮬레이션)

`npm run simulate`로 두 조건을 동시에 만족시킨다:

1. **적중률 55~70%** — 소문 예고 방향과 종가 실제 방향의 일치율.
2. **추종 전략 비지배** — 섹터 소문 추종 전략의 총자산 중앙값이 존버·본전 대비 지배적이지 않을 것.
   기존 조기 방향뉴스(2종·60%·0.7 지점)와 **중첩**되는 점이 최대 리스크. 붕괴 시 대응 레버:
   가짜 개수 상향(적중률↓) → 노출 창 후퇴(추종 이득↓) 순.

시뮬레이터에 섹터 소문 추종 전략(초반 소문 방향대로 해당 섹터 매수)을 추가해 측정한다.

### 6) 문안 콘텐츠

- **`SECTOR_RUMOR_TEMPLATES`** (신규): `Record<sectorCode, Record<'up'|'down', NewsTemplate[]>>`.
  18섹터 × 2방향 × **3개** = **108개** 섹터 고유 문안. `{sector}` 치환 대신 섹터마다 고유 소재로 작성.
  톤은 찌라시체("~더라", "카더라", 미확인 소문). 세계관 캐논(요괴 도시 나라카)·금지 어휘 준수.
- **찌라시꾼 source 풀**: 세계관 캐논 캐릭터 기반 제보자 2~4명(기존 수동 찌라시 `source` 예: "옥자",
  "나라카 숲" 참고). 소문마다 랜덤 배정. 구체 명단은 `naraka-lore-canon` 캐논·기존 콘텐츠에서 확정.

### 7) 제거 항목

- `generateSectorNews`, `SectorNewsInput`, `gradeSector`, `SectorNewsGrade`(4등급) — 대체.
- `SECTOR_NEWS_TEMPLATES`(범용 12개/등급) — `SECTOR_RUMOR_TEMPLATES`로 대체.
- `batchService.ts`의 섹터 평균 등락 계산·후반 발행 블록 — 초반 소문 생성으로 대체.

## 영향 범위 (파일)

| 파일 | 변경 |
|------|------|
| `src/lib/engine/bias.ts` | (불변) — 시세 로직 유지 |
| `src/lib/news/templates.ts` | `SECTOR_NEWS_TEMPLATES` 제거, `SECTOR_RUMOR_TEMPLATES`(108개)·찌라시꾼 풀 추가 |
| `src/lib/news/generate.ts` | `generateSectorNews` 제거, `generateSectorRumors` 추가, `GeneratedNews.source` 추가 |
| `src/services/batchService.ts` | 섹터 뉴스 블록을 소문 생성(진짜+가짜 추첨·초반 배치)으로 교체 |
| `supabase/migrations/*` | 신규 마이그레이션: `apply_daily_batch` news insert에 `source` 추가 |
| `scripts/simulate.ts` | 섹터 소문 추종 전략·적중률 측정 추가 |
| 프론트 `NewsList.tsx` 등 | rumor+null 렌더 확인(등급 배지·source 표기). 큰 변경 없을 전망 |

## 오픈 이슈 (구현 시 확정)

- 노출 창 정확값(0.0~0.2)과 분산 방식.
- 가짜 개수 최종값·진짜 이벤트 3개인 날 총량 캡 여부 — 시뮬레이션 결과에 따름.
- 찌라시꾼 명단 확정.
- 프론트에서 섹터 찌라시를 개별 종목 찌라시와 시각적으로 구분할지(현재는 stock_code=null로 캐시태그만 없음).

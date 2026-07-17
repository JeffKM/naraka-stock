# 섹터 개편 Plan 4 (콘텐츠) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신규 15종의 힌트 뉴스 템플릿(종목당 100개 = 1,500개)과 섹터 뉴스 템플릿(등급당 4→12개)을 나라카 캐논으로 작성하고, 조사 비문·소개문 금지어 위반을 바로잡는다.

**Architecture:** 순수 콘텐츠 작업 — 엔진·배치·스키마 로직은 손대지 않는다. `HINT_TEMPLATES`(코드→레벨→템플릿[])에 신규 15종 키를 추가하고, `SECTOR_NEWS_TEMPLATES`(등급→템플릿[]) 각 등급을 12개로 확장한다. 뉴스 생성 RNG는 가격 경로 생성 **이후**에 소비되므로(generate.ts는 batchService에서만 호출, simulate는 뉴스 미생성) 템플릿 추가는 batch·simulate 가격 재현성에 영향이 없다. 신규 종목은 현재 `HINT_TEMPLATES[code]` 부재로 generate.ts:174에서 skip되어 개별 힌트뉴스가 0건 — 이 공백을 채운다.

**Tech Stack:** TypeScript 5(strict), Next.js 16. 테스트 러너 없음 → 검증은 `npx tsx` 스크래치패드 검수 스크립트(개수·금지어·이모지·조사·플레이스홀더 잔여) + `npm run build` + `npm run lint`.

## Global Constraints

- **캐논 준수(`naraka-lore-canon`)**: 등장인물은 마녀 옥자·구미호 미호·강시 멜·뱀파이어 바나·주방요괴·방문자들 + 펫(시온·코코·규종·선아·수아)이 전부. 새 인물·신·왕 창조 금지.
- **오너 매핑**: 옥자(OK·옥 계열) / 미호(미·MH 계열) / 멜(멜·메루 계열) / 바나(바나·BN 계열). 나라카 3사·미라클은 오너 없는 시 대표 기업.
- **금지 어휘(파생어 포함, 절대 사용 금지)**: 저승, 이승, 천계, 명계, 명부, 도깨비, 옥황상제, 염라대왕, 원혼, 혼령, 혼백, 영혼, 삼도천, 환생, 상여, 성불, 극락.
- **이모지 금지(`no-emoji-in-ui`)**: 문안 전체에 이모지 0개.
- **금융 용어 금지**: 카페 손님 누구나 한 번 읽고 "오르겠네/떨어지겠네"를 느껴야 한다. 톤 = 뉴스 앵커체 + 아기자기한 유머.
- **세기 = 사건 크기**: ±10 소소한 소식 / ±20 큰 소식 / ±30 초대형 사건. 등급은 재료 세기일 뿐 실제 주가는 확률적 실현(방향/세기 문안이 결과를 단정하지 않게).
- **조사 비문 금지**: 한국어 라벨/이름 뒤 조사는 받침에 맞게. 치환 플레이스홀더(`{sector}`/`{name}`) 직후 조사 직결(`{sector}는`)은 라벨에 따라 비문이 되므로 금지 — 조사 없는 표현으로 리라이트.
- **자산은 정수(원)**, 부동소수점 금지 — 이 Plan은 돈/가격 로직을 바꾸지 않는다.
- TypeScript strict, `any` 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트. 개별 임포트.
- **레벨별 개수(종목당 100개, 기존 27종과 동일)**: `"30":10 / "20":10 / "10":15 / "0":30 / "-10":15 / "-20":10 / "-30":10`.
- 스크래치패드 경로: `/private/tmp/claude-501/-Users-jefflee-workspace-naraka-stock/8fefebf7-d34e-4d9a-9cdd-cebf85f376f8/scratchpad` (검수 스크립트는 여기 작성, 커밋하지 않음).

## File Structure

- `src/lib/news/templates.ts` — 유일한 수정 대상. `HINT_TEMPLATES`(line 24~3157) OKCC 블록 뒤에 신규 15종 블록 삽입, `SECTOR_NEWS_TEMPLATES`(line 3187~) 각 등급 12개로 확장, 조사 비문 1건 수정, 13행 주석의 `42종` 확인.
- `supabase/migrations/20260717020000_roster_42_reprice.sql:8` — OKTL 소개문 금지어(`혼백`) 1건 수정. (프로덕션 미개장 전제 — 스펙 §8, 개장 전 마이그레이션 수정 허용.)
- 스크래치패드 `verify-content.ts` — 검수 하네스(비커밋).

## 신규 15종 모티브 브리핑 (콘텐츠 작성 앵커)

각 종목의 소개문(마이그레이션 확정)과 실제 모티브. 힌트 문안은 이 정체성 안에서만 사건을 지어낸다.

| 코드 | 종목명 | tier | 섹터 | 오너/계열 | 모티브 | 소개문(캐논) |
|---|---|---|---|---|---|---|
| OKSC | 옥스코 | stable(우량) | materials | 옥자 | 포스코홀딩스 | 쇠와 불의 명가. 나라카 산업의 뼈대를 대는 철강·소재 대장주. |
| MHOL | 미호오일 | stable(우량) | energy | 미호 | 에스오일 | 기름 한 방울에 울고 웃는 정유 대장. 유가 소식에 출렁인다. |
| BNMR | 바나모레퍼시픽 | stable(우량) | cosmetics | 바나 | 아모레퍼시픽 | 피부에 진심인 화장품 명가. 유행 한 방에 매출이 널뛴다. |
| RTMC | 리얼티 멜컴 | stable(우량) | construction | 멜 | 리얼티 인컴 | 매달 꼬박꼬박 배당 주는 부동산 임대 리츠의 대명사. |
| NRKR | 나라카로보틱스 | stable(우량) | robotics | 시 대표 | 두산로보틱스 | 협동로봇의 선두. 자동화 붐마다 급등락 단골. |
| NRKC | 나라카화학 | normal(일반) | materials | 시 대표 | LG화학 | 플라스틱부터 배터리 소재까지, 나라카 화학의 자존심. |
| NRKH | 나라카중공업 | normal(일반) | defense | 시 대표 | HD현대중공업 | 거대 엔진과 결계 설비를 찍어내는 중공업 강자. |
| OKTL | OKT | normal(일반) | telecom | 옥자 | SK텔레콤 | (수정 후) 요괴 통신망을 깐 통신 1위. 요금제·5G 소식에 반응한다. |
| MHRN | 미호리온 | normal(일반) | food | 미호 | 오리온 | 과자 봉지 하나로 입맛을 평정한 국민 간식 회사. |
| BNEN | 바나나에너빌리티 | normal(일반) | energy | 바나 | 두산에너빌리티 | 원자로와 발전 설비의 명가. 나라카에 불을 대는 에너지주. |
| NRKG | 나라카건설 | normal(일반) | construction | 시 대표 | 현대건설 | 탑과 다리를 올리는 건설 대장. 수주 소식에 들썩인다. |
| MLAB | 멜어비스 | normal(일반) | game | 멜 | 펄어비스 | 대작 게임 하나에 운명을 거는 게임사. 신작 소식에 급등락. |
| MHTR | 미호토로라 | wild(테마) | telecom | 미호 | 모토로라 솔루션즈 | 무전기부터 공공안전 장비까지, 통신 장비 노포. |
| MLTV | 멜튜이티브 | wild(테마) | robotics | 멜 | 인튜이티브 서지컬 | 수술 로봇 팔의 절대강자. 정밀 의료의 미래주. |
| OKBX | 옥블록스 | wild(테마) | game | 옥자 | Roblox | 누구나 게임을 만드는 메타 놀이터. 밈 한 방에 널뛴다. |

---

### Task 1: 검수 하네스 스크립트 작성

**Files:**
- Create(비커밋): `<scratchpad>/verify-content.ts`

**Interfaces:**
- Consumes: `HINT_TEMPLATES`·`SECTOR_NEWS_TEMPLATES`·`SectorNewsGrade`·`BiasLevel`(`src/lib/news/templates.ts`).
- Produces: 없음(검수 전용). 이후 모든 콘텐츠 Task가 이 스크립트로 통과 여부를 확인한다.

이 스크립트는 콘텐츠 작업의 **게이트**다. Task 2·3의 verify 스텝이 이걸 재실행한다.

- [ ] **Step 1: 하네스 작성**

`<scratchpad>/verify-content.ts` 생성:

```ts
import {
  HINT_TEMPLATES,
  SECTOR_NEWS_TEMPLATES,
  type BiasLevel,
  type SectorNewsGrade,
} from "../../src/lib/news/templates";

// 신규 15종 코드 (Plan 4 대상)
const NEW_CODES = [
  "OKSC", "MHOL", "BNMR", "RTMC", "NRKR", "NRKC", "NRKH", "OKTL",
  "MHRN", "BNEN", "NRKG", "MLAB", "MHTR", "MLTV", "OKBX",
];
// 종목당 레벨별 목표 개수 (기존 27종과 동일)
const LEVEL_TARGET: Record<BiasLevel, number> = {
  "30": 10, "20": 10, "10": 15, "0": 30, "-10": 15, "-20": 10, "-30": 10,
};
// 금지 어휘 (naraka-lore-canon)
const FORBIDDEN = [
  "저승", "이승", "천계", "명계", "명부", "도깨비", "옥황상제", "염라대왕",
  "원혼", "혼령", "혼백", "영혼", "삼도천", "환생", "상여", "성불", "극락",
];
// 이모지: 확장 픽토그래프/기호 대략 커버
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/u;
// 치환 플레이스홀더 직후 조사 직결 (비문 위험)
const JOSA_RE = /\{(sector|name)\}(는|은|이|가|을|를|와|과|로|으로|의|에게)/;

const errors: string[] = [];

// 1) 힌트: 신규 15종 존재 + 레벨별 개수 + 제목 중복 없음
for (const code of NEW_CODES) {
  const block = HINT_TEMPLATES[code];
  if (!block) {
    errors.push(`힌트 누락: ${code}`);
    continue;
  }
  const titles = new Set<string>();
  for (const level of Object.keys(LEVEL_TARGET) as BiasLevel[]) {
    const arr = block[level] ?? [];
    if (arr.length !== LEVEL_TARGET[level]) {
      errors.push(`${code} 레벨 ${level}: ${arr.length}개 (목표 ${LEVEL_TARGET[level]})`);
    }
    for (const t of arr) {
      if (titles.has(t.title)) errors.push(`${code} 제목 중복: ${t.title}`);
      titles.add(t.title);
    }
  }
}

// 2) 섹터: 등급별 12개
for (const grade of Object.keys(SECTOR_NEWS_TEMPLATES) as SectorNewsGrade[]) {
  const arr = SECTOR_NEWS_TEMPLATES[grade];
  if (arr.length < 12) errors.push(`섹터 ${grade}: ${arr.length}개 (목표 12)`);
  const titles = new Set<string>();
  for (const t of arr) {
    if (titles.has(t.title)) errors.push(`섹터 ${grade} 제목 중복: ${t.title}`);
    titles.add(t.title);
  }
}

// 3) 전 신규 힌트 + 전 섹터 템플릿: 금지어·이모지·조사·플레이스홀더 잔여 스캔
const scan: { where: string; title: string; body: string }[] = [];
for (const code of NEW_CODES) {
  const block = HINT_TEMPLATES[code];
  if (!block) continue;
  for (const level of Object.keys(LEVEL_TARGET) as BiasLevel[])
    for (const t of block[level] ?? []) scan.push({ where: `${code}/${level}`, ...t });
}
for (const grade of Object.keys(SECTOR_NEWS_TEMPLATES) as SectorNewsGrade[])
  for (const t of SECTOR_NEWS_TEMPLATES[grade]) scan.push({ where: `sector/${grade}`, ...t });

for (const { where, title, body } of scan) {
  const text = `${title} ${body}`;
  for (const w of FORBIDDEN) if (text.includes(w)) errors.push(`금지어 "${w}" @ ${where}: ${title}`);
  if (EMOJI_RE.test(text)) errors.push(`이모지 @ ${where}: ${title}`);
  if (JOSA_RE.test(text)) errors.push(`조사 직결 @ ${where}: ${title}`);
  // 힌트에는 {sector}가, 섹터에는 {name}이 오면 안 됨 (혼용 방지)
  if (where.startsWith("sector/") && (text.includes("{name}") || text.includes("{pct}")))
    errors.push(`섹터에 {name}/{pct} 혼용 @ ${where}`);
  if (!where.startsWith("sector/") && text.includes("{sector}"))
    errors.push(`힌트에 {sector} 혼용 @ ${where}`);
}

if (errors.length) {
  console.log("FAIL");
  for (const e of errors.slice(0, 50)) console.log(" -", e);
  console.log(`총 ${errors.length}건`);
  process.exit(1);
}
console.log("PASS — 신규 15종 힌트·섹터 템플릿 전부 통과");
```

- [ ] **Step 2: 현 상태에서 실패 확인**

Run: `npx tsx <scratchpad>/verify-content.ts`
Expected: FAIL — 신규 15종 전부 "힌트 누락", 섹터 4등급 전부 "12개 미만(4개)", 조사 직결 1건(sector/plungeDown "{sector}는 오늘 쉬어간다").

- [ ] **Step 3: 커밋 없음**

검수 스크립트는 스크래치패드에 두고 커밋하지 않는다. 다음 Task로 진행.

---

### Task 2: 신규 15종 힌트 템플릿 작성 (종목당 100개)

**Files:**
- Modify: `src/lib/news/templates.ts` — `HINT_TEMPLATES` OKCC 블록 닫힘(3156행 `},`) 직후, `HINT_TEMPLATES` 객체 닫힘(3157행 `};`) 전에 신규 15종 블록 삽입.
- Verify: `<scratchpad>/verify-content.ts`

**Interfaces:**
- Consumes: `NewsTemplate`(`{ title: string; body: string }`), `BiasLevel`("30"|"20"|"10"|"0"|"-10"|"-20"|"-30").
- Produces: `HINT_TEMPLATES[code]: Record<BiasLevel, NewsTemplate[]>` 15개 신규 키(위 모티브 표의 코드). 각 값은 레벨별 목표 개수(30:10/20:10/10:15/0:30/-10:15/-20:10/-30:10)를 정확히 채운다. generate.ts는 이 키를 `HINT_TEMPLATES[path.code]`로 조회해 방향·세기별 뉴스를 뽑는다.

**작성 규약(모든 종목 공통):**
- 블록 형태는 기존 27종과 동일:
  ```ts
    OKSC: {
      "30": [ { title: "...", body: "..." }, /* ...10개... */ ],
      "20": [ /* ...10개... */ ],
      "10": [ /* ...15개... */ ],
      "0":  [ /* ...30개... */ ],
      "-10": [ /* ...15개... */ ],
      "-20": [ /* ...10개... */ ],
      "-30": [ /* ...10개... */ ],
    },
  ```
- **방향**: 양수 레벨(+30/+20/+10) = 호재(오를 재료), 음수 레벨(-10/-20/-30) = 악재(내릴 재료), `"0"` = 방향 없는 중립 잡소식(회사가 등장하되 주가 함의 없음: 사옥 급식 메뉴, 사내 행사, 펫 목격담 등).
- **세기**: `30`/`-30` = 초대형(창사 이래 최대, 업계 판도 변화), `20`/`-20` = 큰 소식, `10`/`-10` = 소소한 소식.
- **모티브 앵커**: 각 종목의 소개문·모티브 정체성 안에서 사건을 짓는다(옥스코=철강/쇠·불, 미호오일=유가/정유, 옥블록스=밈/유저 창작 등). 오너가 있는 종목은 오너 캐릭터를 문안에 활용 가능(옥자/미호/멜/바나), 시 대표 기업(나라카 3사·NRKR·NRKC·NRKH·NRKG)은 특정 오너를 등장시키지 않는다.
- **제목 중복 금지**(종목 내). body는 title과 사건이 일관되게.
- 금지어·이모지·조사·금융용어 규약은 Global Constraints를 그대로 적용.

**작성 예시(옥스코 OKSC — 스타일·톤 레퍼런스, 레벨당 일부만 발췌):**

```ts
    OKSC: {
      "30": [
        { title: "옥스코, 나라카 결계탑 전량에 쓰일 \"불사철\" 독점 공급 확정", body: "천 년을 버틴다는 새 강철이 나라카의 모든 결계탑에 들어가게 됐습니다. 계약서에 도장을 찍은 옥스코 대장간은 오늘부터 용광로 불을 끄지 않기로 했습니다." },
        { title: "\"쇠가 모자라 공사가 멈췄다\" — 나라카 전역이 옥스코만 바라본다", body: "새 다리도 새 탑도 옥스코 철이 없으면 첫 삽조차 못 뜨는 형편이 됐습니다. 주문 두루마리가 대장간 문밖까지 굴러 나왔습니다." },
        // ... 총 10개
      ],
      "20": [
        { title: "옥스코, 무게 절반짜리 \"깃털강철\" 개발 성공", body: "짐수레 요괴들이 반색했습니다. 같은 힘으로 두 배를 나르게 됐다는 소식에 대장간 앞이 북적였습니다." },
        // ... 총 10개
      ],
      "10": [
        { title: "옥스코 대장간, 녹슨 간판 새로 달았다", body: "오래된 간판을 새 강판으로 교체하자 골목이 한결 환해졌습니다. 지나던 방문자들이 반짝이는 간판을 한참 올려다봤습니다." },
        // ... 총 15개
      ],
      "0": [
        { title: "옥스코 구내식당, 오늘의 메뉴는 무쇠솥 가마솥밥", body: "두툼한 무쇠솥에 지은 밥이 인기라 점심시간마다 줄이 길다고 합니다. 회사 사정과는 무관한 소소한 소식입니다." },
        // ... 총 30개 (방향 함의 없는 잡소식)
      ],
      "-10": [
        { title: "옥스코 용광로 정기 점검 — 하루 가동 멈춘다", body: "안전 점검으로 대장간이 하루 문을 닫습니다. 큰 차질은 없다지만 납품이 하루씩 밀린다는 이야기가 돕니다." },
        // ... 총 15개
      ],
      "-20": [
        { title: "\"옥스코 철이 예전 같지 않다\" — 납품처 불만 커져", body: "몇몇 공방이 철의 질이 들쭉날쭉하다며 목소리를 높였습니다. 대장간은 원인을 살피는 중이라고 밝혔습니다." },
        // ... 총 10개
      ],
      "-30": [
        { title: "옥스코 최대 용광로 폭발 — 대장간 절반이 잿더미", body: "굉음과 함께 가장 큰 용광로가 무너졌습니다. 다행히 다친 요괴는 없지만 복구까지 얼마가 걸릴지 아무도 장담하지 못하고 있습니다." },
        // ... 총 10개
      ],
    },
```

> 이 규모(1,500개)는 **종목 단위 병렬 생성 + 캐논 검수**가 효율적이다(스펙 §6·§9-4, 서브에이전트 15개 병렬 → 각 100개 작성 → 취합 후 하네스 검수). 인라인 실행 시에는 종목별로 나눠 커밋한다.

- [ ] **Step 1: 15종 힌트 블록 작성·삽입**

위 규약대로 15종 각 100개를 작성해 `HINT_TEMPLATES` OKCC 블록 뒤(3156행 `},` 다음)에 삽입한다. 모티브 표의 정체성을 반영하고, 레벨별 개수를 정확히 맞춘다.

- [ ] **Step 2: 하네스 검수 통과 확인**

Run: `npx tsx <scratchpad>/verify-content.ts`
Expected: 힌트 관련 오류 0건(15종 존재·레벨별 개수·제목중복·금지어·이모지·조사 전부 통과). 섹터 4등급 "12개 미만"만 남음(Task 3에서 해소).

- [ ] **Step 3: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: PASS — 타입/문법 통과(`Record<BiasLevel, NewsTemplate[]>` 형태 준수).

- [ ] **Step 4: 커밋**

```bash
git add src/lib/news/templates.ts
git commit -m "feat: 신규 15종 힌트 뉴스 템플릿 1,500개 작성"
```

(인라인·종목별 분할 실행 시: `feat: 힌트 템플릿 작성 — OKSC·MHOL·...` 식으로 나눠 커밋 가능. 최종 상태는 15종 전부.)

---

### Task 3: 섹터 뉴스 템플릿 확장(등급당 4→12) + 조사 비문 수정

**Files:**
- Modify: `src/lib/news/templates.ts` — `SECTOR_NEWS_TEMPLATES`(3187행~) 각 등급에 8개씩 추가(4→12), 3184행 주석 갱신, 3209행 조사 비문 1건 리라이트.
- Verify: `<scratchpad>/verify-content.ts`

**Interfaces:**
- Consumes: `NewsTemplate`, `SectorNewsGrade`("surgeUp"|"up"|"down"|"plungeDown").
- Produces: `SECTOR_NEWS_TEMPLATES: Record<SectorNewsGrade, NewsTemplate[]>` — 각 등급 12개. `{sector}` 치환 플레이스홀더만 사용(라벨 주입). generate.ts:325의 `pickUnused(rng, SECTOR_NEWS_TEMPLATES[grade], used)`가 소비.

- [ ] **Step 1: 3184행 주석 갱신**

`// 스타터 풀(등급당 4). Plan 4에서 등급당 ~12개 + 섹터별 플레이버 라인으로 확장.` →

```ts
// 등급당 12개 범용 풀(`{sector}` 치환). 실현 섹터 평균 등락으로 등급 결정.
```

- [ ] **Step 2: 조사 비문 수정(3209행)**

`{ title: "\"{sector}는 오늘 쉬어간다\" — 업종 동반 급락", ... }` 를 조사 없는 표현으로:

```ts
    { title: "\"오늘 {sector} 골목은 쉬어간다\" — 업종 동반 급락", body: "{sector} 전반에서 손님이 빠지며 대부분의 가게가 울상을 지었습니다. 상인들은 서로의 어깨를 두드렸습니다." },
```

- [ ] **Step 3: 각 등급 8개씩 추가(4→12)**

`surgeUp` 배열에 추가:

```ts
    { title: "{sector} 골목, 하루 종일 문턱이 닳았다", body: "{sector} 관련 가게마다 손님이 끊이지 않아 문턱이 반질반질해졌습니다. 상인 요괴들은 \"다리가 아픈 게 이렇게 즐거울 줄 몰랐다\"며 웃었습니다." },
    { title: "{sector} 업종, 오늘은 재고가 남지 않았다", body: "{sector} 상점들이 준비한 물건을 죄다 팔아치웠습니다. 늦게 온 방문자들은 텅 빈 진열대 앞에서 아쉬운 발걸음을 돌렸습니다." },
    { title: "{sector} 거리에 웃음소리가 넘쳤다", body: "{sector} 관련주들이 나란히 큰 폭으로 뛰며 골목 전체가 들썩였습니다. 상인들은 오랜만에 어깨춤을 췄습니다." },
    { title: "\"{sector} 간판만 걸면 손님이 온다\" — 업종 동반 급등", body: "{sector} 전반에 훈풍이 몰아치며 문 연 가게마다 즐거운 비명을 질렀습니다. 골목 초입까지 줄이 늘어섰습니다." },
    { title: "{sector} 업종, 오늘만큼은 모두가 대장", body: "작은 가게 큰 가게 할 것 없이 {sector} 골목 전체가 활짝 웃었습니다. 상인들은 서로의 장사를 축하했습니다." },
    { title: "{sector} 거리, 등불이 새벽까지 꺼지지 않았다", body: "{sector} 관련 상점들이 밀려드는 손님에 밤늦도록 문을 닫지 못했습니다. 상인 요괴들은 \"이런 피로는 반갑다\"고 전했습니다." },
    { title: "{sector} 업종에 손님 물결 — 골목이 미어터졌다", body: "{sector} 관련 가게마다 발 디딜 틈이 없었습니다. 대부분의 상점이 문 연 지 얼마 되지 않아 즐거운 매진을 알렸습니다." },
    { title: "{sector} 골목, 오늘은 축포가 필요했다", body: "{sector} 관련주들이 약속이나 한 듯 크게 뛰었습니다. 상인들은 \"이런 날은 일 년에 몇 번 없다\"며 함박웃음을 지었습니다." },
```

`up` 배열에 추가:

```ts
    { title: "{sector} 골목에 손님이 조금씩 늘었다", body: "{sector} 관련 상점들이 어제보다 나은 하루를 보냈습니다. 요란하진 않아도 발길이 꾸준했습니다." },
    { title: "{sector} 업종, 오늘은 표정이 밝다", body: "{sector} 상인 요괴들이 오랜만에 웃으며 손님을 맞았습니다. 큰 소란 없이도 흥정이 정겹게 오갔습니다." },
    { title: "{sector} 거리에 온기가 돌았다", body: "{sector} 관련주들이 완만하게 올랐습니다. 상인들은 \"조금씩 나아지는 게 어디냐\"며 서로를 다독였습니다." },
    { title: "{sector} 업종, 어제보다 반 걸음 앞으로", body: "{sector} 골목 곳곳에서 소소한 흥정이 이어졌습니다. 대부분의 가게가 무난한 하루를 보냈습니다." },
    { title: "{sector} 골목, 오늘은 헛걸음이 적었다", body: "{sector} 관련 상점을 찾은 방문자들이 대체로 손에 물건을 들고 나섰습니다. 상인들은 \"이 정도면 족하다\"고 전했습니다." },
    { title: "{sector}에 살랑이는 봄바람", body: "{sector} 관련 가게들이 잔잔하게 활기를 띠었습니다. 크게 뛰진 않아도 하루 종일 문이 여닫혔습니다." },
    { title: "{sector} 업종, 조용히 웃은 하루", body: "{sector} 상점들이 소소하게 재미를 봤습니다. 상인 요괴들은 \"티 나지 않아도 좋은 날\"이라고 말했습니다." },
    { title: "{sector} 거리, 발길이 끊이지 않았다", body: "{sector} 관련주들이 완만한 오름세를 보였습니다. 요란한 소식은 없었지만 손님은 꾸준했습니다." },
```

`down` 배열에 추가:

```ts
    { title: "{sector} 골목, 오늘은 헛걸음이 잦았다", body: "{sector} 관련 상점을 찾았다 빈손으로 돌아서는 방문자가 늘었습니다. 상인들은 처마 밑에서 한숨을 골랐습니다." },
    { title: "{sector} 업종, 표정이 굳었다", body: "{sector} 관련주들이 완만하게 밀렸습니다. 상인 요괴들은 \"이런 날도 견뎌야지\"라며 서로를 다독였습니다." },
    { title: "{sector} 거리에 옅은 한기", body: "{sector} 골목의 흥정 소리가 눈에 띄게 줄었습니다. 대부분의 가게가 조용한 하루를 보냈습니다." },
    { title: "{sector} 업종, 어제보다 반 걸음 뒤로", body: "{sector} 관련 상점들이 대체로 한산했습니다. 큰 소란은 없었지만 손님이 성겼습니다." },
    { title: "{sector} 골목, 오늘은 손님이 뜸했다", body: "{sector} 관련주들이 소폭 밀렸습니다. 상인들은 \"기다리다 보면 오겠지\"라며 문을 지켰습니다." },
    { title: "{sector}에 스산한 바람 한 줄기", body: "{sector} 관련 가게들이 소소하게 웅크렸습니다. 발길이 성긴 하루였습니다." },
    { title: "{sector} 업종, 조용히 밀린 하루", body: "{sector} 상점들이 이렇다 할 재미를 보지 못했습니다. 상인 요괴들은 \"이런 날은 일찍 접는 게 낫다\"고 전했습니다." },
    { title: "{sector} 거리, 문 여닫는 소리가 줄었다", body: "{sector} 관련주들이 완만한 내림세를 보였습니다. 요란한 악재는 없었지만 손님이 적었습니다." },
```

`plungeDown` 배열에 추가:

```ts
    { title: "{sector} 골목, 하루 종일 문이 닫혀 있었다", body: "{sector} 관련 가게들이 손님이 없어 일찌감치 셔터를 내렸습니다. 골목 전체가 적막에 잠겼습니다." },
    { title: "{sector} 업종, 오늘은 재고가 그대로 쌓였다", body: "{sector} 상점들이 준비한 물건을 거의 팔지 못했습니다. 상인 요괴들은 텅 빈 계산대를 바라보며 한숨을 쉬었습니다." },
    { title: "{sector} 거리에 찬 서리가 내렸다", body: "{sector} 관련주들이 나란히 큰 폭으로 밀리며 골목 전체가 얼어붙었습니다. 상인들은 서로의 어깨를 두드렸습니다." },
    { title: "\"{sector} 간판을 내릴까\" — 업종 동반 급락", body: "{sector} 전반에서 손님이 뚝 끊기며 문 연 가게마다 울상을 지었습니다. 골목 초입까지 한기가 돌았습니다." },
    { title: "{sector} 업종, 오늘만큼은 모두가 힘들었다", body: "작은 가게 큰 가게 할 것 없이 {sector} 골목 전체가 어깨를 늘어뜨렸습니다. 상인들은 서로의 하루를 위로했습니다." },
    { title: "{sector} 거리, 등불이 초저녁부터 꺼졌다", body: "{sector} 관련 상점들이 손님이 없어 일찍 불을 껐습니다. 상인 요괴들은 \"이런 날은 얼른 자는 게 낫다\"고 전했습니다." },
    { title: "{sector} 업종에 찬바람 몰아쳐 — 골목이 텅 비었다", body: "{sector} 관련 가게마다 손님 그림자조차 보기 어려웠습니다. 대부분의 상점이 문 연 지 얼마 안 돼 다시 닫았습니다." },
    { title: "{sector} 골목, 오늘은 한숨이 필요했다", body: "{sector} 관련주들이 약속이나 한 듯 크게 밀렸습니다. 상인들은 \"이런 날은 처음\"이라며 서로를 다독였습니다." },
```

- [ ] **Step 4: 하네스 검수 통과 확인**

Run: `npx tsx <scratchpad>/verify-content.ts`
Expected: **PASS** — 힌트 15종·섹터 4등급(각 12개) 전부 통과, 조사 직결 0건.

- [ ] **Step 5: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/news/templates.ts
git commit -m "feat: 섹터 뉴스 템플릿 등급당 12개 확장·조사 비문 수정"
```

---

### Task 4: 소개문 금지어 수정 + 최종 검수

**Files:**
- Modify: `supabase/migrations/20260717020000_roster_42_reprice.sql:8` — OKTL 소개문 `혼백` → `요괴`.
- Verify: `grep` 전수 스캔 + `npm run build`.

**Interfaces:**
- Consumes: 없음. Produces: 없음(콘텐츠 수정).

프로덕션 미개장 전제(스펙 §8)라 마이그레이션 파일 직접 수정이 허용된다. Plan 5의 prod db push·리허설 재생성 때 반영된다.

- [ ] **Step 1: OKTL 소개문 수정**

`supabase/migrations/20260717020000_roster_42_reprice.sql` 8행:

```sql
  ('OKTL','OKT','normal','telecom','요괴 통신망을 깐 통신 1위. 요금제·5G 소식에 반응한다.',27000000),
```

- [ ] **Step 2: 마이그레이션 전수 금지어 스캔**

Run:
```bash
grep -nE "저승|이승|천계|명계|명부|도깨비|옥황|염라|원혼|혼령|혼백|영혼|삼도천|환생|상여|성불|극락" supabase/migrations/20260717020000_roster_42_reprice.sql
```
Expected: 출력 없음(모든 소개문이 캐논 통과).

- [ ] **Step 3: 템플릿 전체 금지어·이모지 재스캔(회귀 방지)**

Run:
```bash
grep -nE "저승|이승|천계|명계|명부|도깨비|옥황|염라|원혼|혼령|혼백|영혼|삼도천|환생|상여|성불|극락" src/lib/news/templates.ts
```
Expected: 출력 없음. (`verify-content.ts`가 이미 신규분을 검사하지만, 이 grep은 파일 전체 회귀 안전망.)

- [ ] **Step 4: 하네스 최종 재확인**

Run: `npx tsx <scratchpad>/verify-content.ts`
Expected: PASS.

- [ ] **Step 5: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/20260717020000_roster_42_reprice.sql
git commit -m "fix: OKTL 소개문 금지어(혼백) 캐논 정합 수정"
```

---

## Plan 4 종료 후 (이 Plan 범위 밖 — 기록용)

- **실앱 verify**: `verify` 스킬(dev + agent-browser)로 신규 15종 상세/뉴스 피드에 힌트뉴스가, 섹터 뉴스가 확장 풀로 뜨는지 확인 — **로컬 배치 재생성 필요**(Plan 5 리허설 재생성과 함께).
- **Plan 5로 이월**: simulate `STOCKS` 42종/신규 기준가 갱신 + 1,000만 재검증·튜닝, prod db push(리허설 계정 정리→+900만 마이그레이션 순서), 리허설 재생성.

## Self-Review

- **스펙 커버리지(§5·§6 + 조사/금지어):**
  - §6 신규 15종 힌트 템플릿(종목당 100개, 총 1,500개) → Task 2 ✅ (사장님 결정: 기존 100개/종목 물량)
  - §6 소개문 — 이미 마이그레이션에 존재, 단 OKTL 금지어 위반 → Task 4 수정 ✅
  - §5 섹터 뉴스 템플릿 등급당 ~12개(`{sector}` 치환 범용 풀) → Task 3 ✅
  - 조사 비문(`{sector}는`) → Task 3 Step 2 ✅
  - near-zero 컷오프 → **스코프 아웃**(사장님 결정: 현행 4등급 유지) — 미포함이 의도 ✅
- **플레이스홀더 스캔:** Task 3·4는 완성 코드/명령. Task 2는 1,500개 콘텐츠 authoring 작업으로, 규약·레벨별 개수·모티브 표·완결 예시·검수 하네스로 실행자가 추가 질문 없이 작성 가능하게 명세(콘텐츠 생성 태스크의 본성상 전량 사전작성 불가 — 대신 게이트를 하네스로 강제) ✅
- **타입 일관성:** `NewsTemplate{title,body}`, `BiasLevel`(7값), `SectorNewsGrade`(4값), `HINT_TEMPLATES: Record<string, Record<BiasLevel, NewsTemplate[]>>`, `SECTOR_NEWS_TEMPLATES: Record<SectorNewsGrade, NewsTemplate[]>` — 기존 파일 정의와 동일 ✅
- **RNG 안전성:** 뉴스 생성은 가격 경로 이후 소비·simulate 미사용이라 batch/simulate 가격 재현성 불변 → 밸런스 영향 없음(Plan 5 회귀 대조와 무관하게 통과 예상) ✅

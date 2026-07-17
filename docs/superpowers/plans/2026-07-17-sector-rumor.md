# 섹터 찌라시 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 섹터 뉴스를 "장 후반 사후 설명 정식뉴스"에서 "장 초반 예고 찌라시(진짜+가짜 섞음, 적중률 55~70%)"로 전환한다.

**Architecture:** 시세 엔진(`drawSectorEvents`/`applySectorEvents`)은 불변. 뉴스 레이어만 교체한다 — 실현 결과를 4등급화하던 `generateSectorNews`를 제거하고, 이벤트의 의도 방향을 예고하는 `generateSectorRumors`(진짜 이벤트 방향 + 이벤트 없는 섹터의 가짜 소문)를 장 0~20% 초반 창에 `grade='rumor'`로 배치한다. 자동 뉴스에 찌라시꾼 이름을 붙이기 위해 `apply_daily_batch`에 `source` 컬럼을 추가한다.

**Tech Stack:** TypeScript 5(strict), Next.js 16, Supabase Postgres(pg_cron 배치), tsx 시뮬레이터.

## Global Constraints

- TypeScript strict — `any` 금지, 들여쓰기 2칸, 세미콜론, 더블 쿼트, 개별 임포트.
- **테스트 프레임워크 없음.** 검증은 `npm run build`(타입) + `npm run lint`(ESLint) + `npm run simulate`(밸런스 몬테카를로) + 필요 시 임시 `tsx` 스크립트 assert. vitest/jest 도입 금지(YAGNI, 프로젝트 관례).
- **세계관 캐논** — 등장인물은 옥자(마녀)·미호(구미호)·멜(강시)·바나(뱀파이어)·주방요괴·방문자들 **뿐**. 새 인물 창조 금지. 무대는 요괴 도시 "나라카", 시민=요괴, 손님=방문자.
- **금지 어휘(파생어 포함)**: 저승, 이승, 천계, 명계, 명부, 도깨비, 옥황상제, 염라대왕, 원혼, 혼령, 혼백, 영혼, 삼도천, 환생, 상여, 성불, 극락. 새 문안은 이 목록으로 `grep` 검수 필수.
- **UI/문안에 이모지 금지.**
- 자산은 정수(원). 섹터 소문은 `stock_code = null`(시장 전체 표식) 유지.
- **시드 재현성**: `batchService.ts`와 `scripts/simulate.ts`는 동일한 RNG 소비 순서를 유지해야 한다. 섹터 소문의 RNG 소비는 가격 경로 생성이 모두 끝난 뒤(뉴스 구간)라 시세엔 무관하지만, 두 경로에서 같은 함수를 같은 지점에서 호출한다.
- 커밋 메시지: `type: 한국어 설명` (feat/fix/refactor/docs/chore).

**섹터 코드 18종** (from `scripts/simulate.ts` STOCKS / `stocks.sector`): `semiconductor, electronics, it, retail, auto, media, finance, defense, bio, energy, materials, food, cosmetics, shipaero, telecom, game, robotics, construction`. 한국어 라벨은 런타임에 `sectors.label_ko`로 주입(§Task 4).

---

### Task 1: `apply_daily_batch`에 `source` 컬럼 추가 (DB 마이그레이션)

자동 뉴스 insert가 현재 `source`를 넣지 않아 자동 찌라시에 기자명을 붙일 수 없다. `20260716020000_volume.sql`의 `apply_daily_batch` 정의를 베이스로, `source`만 추가한 새 마이그레이션을 만든다(함수 전체 `create or replace`).

**Files:**
- Create: `supabase/migrations/20260717030000_news_source_in_batch.sql`
- Reference: `supabase/migrations/20260716020000_volume.sql:1-140` (현행 정의 복사 원본)

**Interfaces:**
- Produces: `apply_daily_batch(p_news jsonb)`가 `p_news[].source`(text, nullable)를 읽어 `news.source`에 insert.

- [ ] **Step 1: 현행 함수 정의 확인**

Run: `sed -n '1,140p' supabase/migrations/20260716020000_volume.sql`
현행 `apply_daily_batch` 전체 본문을 확인한다(이 함수 정의를 그대로 복사해 source만 추가할 것).

- [ ] **Step 2: 새 마이그레이션 작성**

`20260716020000_volume.sql`의 `create or replace function apply_daily_batch ... $$ language plpgsql;` 전체를 그대로 복사하되, 뉴스 반영 블록(§4)만 아래처럼 `source`를 추가한다. **다른 블록(정산·배당·틱·config)은 원본과 100% 동일해야 한다.**

```sql
-- 20260717030000_news_source_in_batch.sql
-- 자동 뉴스 insert에 source(제보자·매체) 추가 — 섹터 찌라시가 찌라시꾼 이름을 갖도록.
-- 20260716020000_volume.sql의 apply_daily_batch를 베이스로 §4 뉴스 블록만 수정.

create or replace function apply_daily_batch(
  -- ... 원본과 동일한 파라미터 전체를 그대로 복사 ...
) returns jsonb
language plpgsql
as $$
declare
  -- ... 원본과 동일 ...
begin
  -- 1) 정산 · 2) 배당 · 3) 틱  ← 원본 그대로 복사

  -- 4) 자동 뉴스 반영 (수동 뉴스 보존) — source 추가
  if jsonb_array_length(p_news) > 0 then
    delete from news
      where is_auto
        and (
          (grade = 'disclosure' and date in (
            select distinct (x.date)::date
            from jsonb_to_recordset(p_news) as x(date text, grade text)
            where x.grade = 'disclosure'))
          or (grade in ('news', 'rumor') and date in (
            select distinct (x.date)::date
            from jsonb_to_recordset(p_news) as x(date text, grade text)
            where x.grade in ('news', 'rumor')))
        );

    insert into news (date, stock_code, grade, title, body, source, is_auto, published_at)
    select (x.date)::date, x.stock_code, x.grade, x.title, x.body, x.source, true,
      coalesce((x.published_at)::timestamptz, now())
    from jsonb_to_recordset(p_news)
      as x(date text, stock_code text, grade text, title text, body text,
           source text, published_at text);
    get diagnostics v_news_inserted = row_count;
  end if;

  -- 5) 배치 실행 기록 · return  ← 원본 그대로 복사
end $$;
```

- [ ] **Step 3: 로컬 DB에 적용**

Run: `npx supabase db reset`
Expected: 마이그레이션 전체가 에러 없이 적용되고 seed까지 완료.

- [ ] **Step 4: source 반영 검증 (SQL)**

Run:
```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -c \
"select apply_daily_batch('2026-08-01', false, false, 0, null, '[]'::jsonb, '[]'::jsonb,
 '[{\"date\":\"2026-08-01\",\"stock_code\":null,\"grade\":\"rumor\",\"title\":\"t\",\"body\":\"b\",\"source\":\"옥자\",\"published_at\":null}]'::jsonb);
 select grade, source from news where source = '옥자';"
```
Expected: `rumor | 옥자` 한 행. (파라미터 순서/개수는 Step 1에서 확인한 실제 시그니처에 맞춘다.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260717030000_news_source_in_batch.sql
git commit -m "feat: apply_daily_batch news insert에 source 컬럼 추가 (자동 찌라시 기자명)"
```

---

### Task 2: `GeneratedNews.source` 필드 + 배치 RPC 매핑

TS 뉴스 타입과 배치 RPC 페이로드에 `source`를 실어 Task 1의 DB 경로와 연결한다.

**Files:**
- Modify: `src/lib/news/generate.ts:37-44` (GeneratedNews 인터페이스)
- Modify: `src/services/batchService.ts:267-274` (p_news 매핑)

**Interfaces:**
- Produces: `GeneratedNews.source?: string | null`. 기존 생성기(정식뉴스·공시·중립)는 이 필드를 세팅하지 않으므로 `undefined` → RPC에서 `null`로 매핑.

- [ ] **Step 1: GeneratedNews에 source 추가**

`src/lib/news/generate.ts`의 인터페이스를 수정:
```typescript
export interface GeneratedNews {
  date: string;
  stockCode: string | null;
  grade: NewsGrade;
  title: string;
  body: string;
  source?: string | null; // 제보자·매체 (섹터 찌라시만 사용, 나머지는 undefined→null)
  publishedAt: string; // ISO timestamptz — 이 시각부터 피드에 노출
}
```

- [ ] **Step 2: 배치 RPC 페이로드에 source 매핑**

`src/services/batchService.ts`의 `p_news.map`에 한 줄 추가:
```typescript
    p_news: news.map((n) => ({
      date: n.date,
      stock_code: n.stockCode,
      grade: n.grade,
      title: n.title,
      body: n.body,
      source: n.source ?? null,
      published_at: n.publishedAt,
    })),
```

- [ ] **Step 3: 타입 검증**

Run: `npm run build`
Expected: 타입 에러 없이 빌드 성공.

- [ ] **Step 4: Commit**

```bash
git add src/lib/news/generate.ts src/services/batchService.ts
git commit -m "feat: GeneratedNews.source 필드·배치 RPC 매핑 추가"
```

---

### Task 3: `SECTOR_RUMOR_TEMPLATES` + 찌라시꾼 풀 (콘텐츠 108개)

범용 `SECTOR_NEWS_TEMPLATES`를 제거하고, 18섹터 × 2방향(up/down) × 3개 = 108개 섹터 고유 찌라시 문안을 만든다. 각 섹터의 소재는 그 섹터 대표 종목/업종 성격에서 뽑되 종목명({name})은 쓰지 않는다(섹터 전체 소문). 찌라시체("~라더라", "~라는 소문", 미확인)로 작성한다.

**Files:**
- Modify: `src/lib/news/templates.ts:4922-4984` (SECTOR_NEWS_TEMPLATES 제거 → SECTOR_RUMOR_TEMPLATES 추가)
- Reference: `supabase/seed.sql` 또는 `sectors` 테이블 (label_ko 확인용)

**Interfaces:**
- Produces:
  - `export type SectorRumorDirection = "up" | "down";`
  - `export const SECTOR_RUMOR_TEMPLATES: Record<string, Record<SectorRumorDirection, NewsTemplate[]>>` — 키는 섹터 코드 18종, 각 방향당 정확히 3개.
  - `export const RUMORMONGERS: readonly string[]` — 찌라시꾼 source 풀.
- Removes: `SECTOR_NEWS_TEMPLATES`, `SectorNewsGrade`.

- [ ] **Step 1: 섹터 라벨 확인**

Run: `grep -n "label_ko\|insert into sectors\|values" supabase/seed.sql | head -40`
18개 섹터 코드 ↔ 한국어 라벨 매핑을 확보한다(문안 어휘를 라벨과 일관되게 쓰기 위함).

- [ ] **Step 2: 찌라시꾼 풀 정의**

`templates.ts`에 추가(세계관 캐논 캐릭터·매체명만):
```typescript
// 섹터 찌라시 제보자(source) 풀 — 세계관 캐논 캐릭터/매체명만. 새 인물 창조 금지.
export const RUMORMONGERS: readonly string[] = [
  "옥자", "미호", "멜", "바나", "주방요괴", "나라카 카더라통신", "골목 소문",
];
```

- [ ] **Step 3: SECTOR_NEWS_TEMPLATES 제거, SECTOR_RUMOR_TEMPLATES 추가**

`templates.ts:4922-4984`의 `SectorNewsGrade`·`SECTOR_NEWS_TEMPLATES` 블록을 삭제하고 아래 구조로 교체한다. **18섹터 전부**를 채운다(아래는 형식·톤 기준을 보이는 대표 예시 2섹터 — 나머지 16섹터도 동일 밀도로, 각 방향 3개씩 섹터 고유 소재로 작성):

```typescript
export type SectorRumorDirection = "up" | "down";

// 섹터 찌라시 템플릿 — 장 초반 예고(미확인 소문). 섹터 고유 소재, 종목명 미사용.
// 방향 2단계(up/down)·섹터당 3개. 찌라시체("~라더라"). 금지 어휘 grep 검수 완료.
export const SECTOR_RUMOR_TEMPLATES: Record<
  string,
  Record<SectorRumorDirection, NewsTemplate[]>
> = {
  semiconductor: {
    up: [
      { title: "반도체 골목에 큰손이 떴다더라", body: "반도체 거리 상점들이 오늘 물건을 대량으로 들여놨다는 소문입니다. 누군가 미리 귀띔을 받았다는 말이 돌더라는데, 확인된 건 없습니다." },
      { title: "\"오늘 반도체는 웃는다\" — 뒷골목 소문", body: "반도체 업종에 좋은 바람이 분다는 이야기가 방문자들 사이에 파다합니다. 상인 요괴들도 반신반의하며 셔터를 일찍 올렸다더라." },
      { title: "반도체 거리, 심상찮은 기운이 돈다는 말", body: "누가 그러는데 오늘 반도체 골목에 손님이 몰릴 거라더라. 근거는 없지만 상점들이 재고를 서둘러 채웠다는 소문입니다." },
    ],
    down: [
      { title: "반도체 골목, 오늘은 조용할 거라더라", body: "반도체 거리에 찬바람이 분다는 소문이 돕니다. 큰손이 발을 뺐다는 말이 있지만 확인된 바는 없습니다." },
      { title: "\"반도체는 접어두라\"는 뒷말", body: "오늘 반도체 업종이 힘을 못 쓸 거라는 이야기가 골목에 파다합니다. 상인 요괴들이 일찍 문 닫을 채비를 한다더라." },
      { title: "반도체 거리에 스산한 소문 한 줄기", body: "반도체 골목 손님이 뚝 끊길 거라는 말이 돌더라는데, 어디서 시작된 소문인지는 아무도 모릅니다." },
    ],
  },
  bio: {
    up: [
      { title: "바이오 골목에 회춘 물약이 동났다는 소문", body: "나라카바이오 거리에 좋은 물약이 들어왔다는 이야기가 방문자들 사이에 돕니다. 미리 줄 선 요괴가 있다더라는데 확인은 안 됩니다." },
      { title: "\"오늘 바이오는 오른다\"는 귀띔", body: "바이오 업종에 훈풍이 분다는 소문이 골목에 파다합니다. 상인 요괴들도 기대 섞인 눈치라더라." },
      { title: "바이오 거리, 심상찮게 붐빌 거라는 말", body: "오늘 바이오 골목에 손님이 몰릴 거라는 뒷말이 돕니다. 근거는 없지만 가게마다 물약을 넉넉히 채웠다는 소문입니다." },
    ],
    down: [
      { title: "바이오 골목, 오늘은 한산할 거라더라", body: "바이오 거리에 손님이 뜸할 거라는 소문이 돕니다. 물약이 시원찮다는 뒷말이 있지만 확인된 건 없습니다." },
      { title: "\"바이오는 쉬어간다\"는 뒷골목 이야기", body: "오늘 바이오 업종이 가라앉을 거라는 말이 골목에 파다합니다. 상인 요괴들 표정이 어둡다더라." },
      { title: "바이오 거리에 옅은 그늘이 진다는 소문", body: "바이오 골목 발길이 줄 거라는 이야기가 돌더라는데, 누가 퍼뜨린 소문인지는 아무도 모릅니다." },
    ],
  },
  // electronics, it, retail, auto, media, finance, defense, energy, materials,
  // food, cosmetics, shipaero, telecom, game, robotics, construction — 동일 밀도로 채움
};
```

- [ ] **Step 4: 금지 어휘 검수**

Run:
```bash
grep -nE "저승|이승|천계|명계|명부|도깨비|옥황상제|염라대왕|원혼|혼령|혼백|영혼|삼도천|환생|상여|성불|극락" src/lib/news/templates.ts
```
Expected: 새로 추가한 SECTOR_RUMOR_TEMPLATES 범위에서 매치 0건.

- [ ] **Step 5: 개수·구조 검증 (임시 tsx)**

Run:
```bash
npx tsx -e "import {SECTOR_RUMOR_TEMPLATES as T} from './src/lib/news/templates.ts'; const secs=Object.keys(T); console.log('sectors',secs.length); for(const s of secs){for(const d of ['up','down']){const n=T[s][d].length; if(n!==3) throw new Error(s+' '+d+' = '+n);}} console.log('OK: 18*2*3 = '+secs.length*2*3);"
```
Expected: `sectors 18` / `OK: 18*2*3 = 108`. (섹터 코드 오탈자·개수 오류를 여기서 잡는다.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/news/templates.ts
git commit -m "feat: 섹터 찌라시 문안 108종·찌라시꾼 풀 추가, 범용 섹터뉴스 템플릿 제거"
```

---

### Task 4: `generateSectorRumors` 함수 (진짜+가짜 추첨·초반 배치)

`generateSectorNews`(실현 4등급·후반)를 제거하고, 이벤트 방향을 예고하는 초반 찌라시 생성기를 만든다.

**Files:**
- Modify: `src/lib/news/generate.ts:288-337` (SectorNewsInput·gradeSector·generateSectorNews 제거 → generateSectorRumors 추가)
- Modify: `src/lib/news/generate.ts:27-35` (import: SECTOR_NEWS_TEMPLATES→SECTOR_RUMOR_TEMPLATES, RUMORMONGERS 추가)

**Interfaces:**
- Consumes: `SectorEvent`(`{sector, direction: 1|-1, magnitude}` from `@/lib/engine/bias`), `SECTOR_RUMOR_TEMPLATES`, `RUMORMONGERS`, `pickUnused`(기존).
- Produces:
  ```typescript
  export function generateSectorRumors(
    events: SectorEvent[],            // 진짜 이벤트 (방향 그대로 예고)
    allSectors: string[],            // 로스터에 존재하는 섹터 코드 전체 (가짜 후보 풀)
    totalTicks: number,
    tomorrowDate: string,
    openHour: number,
    rng: Rng,
    fakeMin: number = 1,             // 가짜 소문 최소 (밸런스 파라미터)
    fakeMax: number = 2,             // 가짜 소문 최대
  ): GeneratedNews[];
  ```

- [ ] **Step 1: import 교체**

`generate.ts` 상단 import에서 `SECTOR_NEWS_TEMPLATES`, `SectorNewsGrade` 제거하고 추가:
```typescript
import {
  DISCLOSURE_TEMPLATES,
  HINT_TEMPLATES,
  RUMORMONGERS,
  SECTOR_RUMOR_TEMPLATES,
  type BiasLevel,
  type DisclosureKind,
  type NewsTemplate,
  type SectorRumorDirection,
} from "./templates";
import type { SectorEvent } from "@/lib/engine/bias";
```

- [ ] **Step 2: generateSectorNews 블록 제거, generateSectorRumors 작성**

`generate.ts:288-337`(주석 포함 `SectorNewsInput`~`generateSectorNews`)를 삭제하고 교체:
```typescript
// 섹터 찌라시 (섹터 개편 v2, spec 2026-07-17): 장 초반 예고성 소문.
// 진짜 = 이벤트 방향 그대로 예고(참여확률 탓 자연 적중<100%). 가짜 = 이벤트 없는 섹터
// 랜덤 fakeMin~fakeMax개를 랜덤 방향으로 예고. grade='rumor'(55%)·stock_code=null.
// 노출은 장 초반 창(0~RUMOR_WINDOW_RATIO)에 균등+지터 분산. source=찌라시꾼 랜덤.
const RUMOR_WINDOW_RATIO = 0.2; // 초반 노출 창 상한 (0~20% 지점). 밸런스 시 후퇴 가능

function dirKey(direction: number): SectorRumorDirection {
  return direction >= 0 ? "up" : "down";
}

export function generateSectorRumors(
  events: SectorEvent[],
  allSectors: string[],
  totalTicks: number,
  tomorrowDate: string,
  openHour: number,
  rng: Rng,
  fakeMin: number = 1,
  fakeMax: number = 2
): GeneratedNews[] {
  // 진짜 소문: 이벤트 방향 예고
  const rumors: Array<{ sector: string; direction: SectorRumorDirection }> = events
    .filter((e) => SECTOR_RUMOR_TEMPLATES[e.sector])
    .map((e) => ({ sector: e.sector, direction: dirKey(e.direction) }));

  // 가짜 소문: 이벤트 없는 섹터 중 랜덤 N개, 랜덤 방향
  const eventSectors = new Set(events.map((e) => e.sector));
  const fakePool = allSectors.filter(
    (s) => !eventSectors.has(s) && SECTOR_RUMOR_TEMPLATES[s]
  );
  const fakeCount = Math.min(
    fakePool.length,
    fakeMin + Math.floor(rng() * (fakeMax - fakeMin + 1))
  );
  for (let i = 0; i < fakeCount; i++) {
    const idx = Math.floor(rng() * fakePool.length);
    const sector = fakePool.splice(idx, 1)[0];
    const direction: SectorRumorDirection = rng() < 0.5 ? "up" : "down";
    rumors.push({ sector, direction });
  }

  // 초반 창에 균등 슬롯 + ±1틱 지터로 분산 (개장 직후 한 틱 몰림 방지)
  const windowTicks = Math.max(1, Math.floor(totalTicks * RUMOR_WINDOW_RATIO));
  const n = rumors.length;
  const usedByDir: Record<SectorRumorDirection, Map<string, number>> = {
    up: new Map(),
    down: new Map(),
  };
  return rumors.map((r, i) => {
    const used = usedByDir[r.direction];
    const tmpl = pickUnused(rng, SECTOR_RUMOR_TEMPLATES[r.sector][r.direction], used);
    used.set(tmpl.title, (used.get(tmpl.title) ?? 0) + 1);
    const center = Math.floor((windowTicks * (i + 0.5)) / Math.max(1, n));
    const jitter = Math.floor(rng() * 3) - 1; // -1..+1
    const tick = Math.max(0, Math.min(windowTicks, center + jitter));
    const source = RUMORMONGERS[Math.floor(rng() * RUMORMONGERS.length)];
    return {
      date: tomorrowDate,
      stockCode: null,
      grade: "rumor" as const,
      title: tmpl.title,
      body: tmpl.body,
      source,
      publishedAt: tickTimestamp(tomorrowDate, tick, openHour),
    };
  });
}
```

- [ ] **Step 3: 타입·재현성 스모크 (임시 tsx)**

Run:
```bash
npx tsx -e "
import {generateSectorRumors} from './src/lib/news/generate.ts';
import {createRng, hashSeed} from './src/lib/engine/rng.ts';
const secs=['semiconductor','bio','it','retail','auto','media'];
const ev=[{sector:'semiconductor',direction:1,magnitude:15},{sector:'bio',direction:-1,magnitude:15}];
const a=generateSectorRumors(ev,secs,144,'2026-08-02',12,createRng(hashSeed('x')));
const b=generateSectorRumors(ev,secs,144,'2026-08-02',12,createRng(hashSeed('x')));
console.log('count',a.length,'grades',[...new Set(a.map(n=>n.grade))],'sources',a.map(n=>n.source));
if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error('시드 비재현');
console.log('OK 재현성·grade=rumor·source 부착');
"
```
Expected: 진짜 2 + 가짜 1~2 = 3~4건, `grade` 전부 `rumor`, source 채워짐, 재현성 OK. (rng 함수 경로가 다르면 실제 export 명에 맞춰 조정.)

- [ ] **Step 4: 빌드**

Run: `npm run build`
Expected: 성공 (generateSectorNews 참조가 남아 있으면 에러 → Task 5에서 제거).

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/generate.ts
git commit -m "feat: generateSectorRumors 추가(진짜+가짜 예고·초반 분산), generateSectorNews 제거"
```

---

### Task 5: 배치 통합 (`batchService.ts`)

후반 섹터 정식뉴스 블록을 초반 찌라시 생성으로 교체한다.

**Files:**
- Modify: `src/services/batchService.ts:221-244` (섹터 평균 계산·generateSectorNews 블록)
- Modify: `src/services/batchService.ts` import (generateSectorNews→generateSectorRumors, SectorNewsInput 제거)

**Interfaces:**
- Consumes: `generateSectorRumors`(Task 4), `sectorEvents`(기존 `drawSectorEvents` 결과), `biasTargets`.

- [ ] **Step 1: import 교체**

`batchService.ts`의 generate import에서 `generateSectorNews`, `SectorNewsInput`을 제거하고 `generateSectorRumors`를 추가한다.

- [ ] **Step 2: 섹터 뉴스 블록 교체**

`batchService.ts:221-244`(주석 "// 섹터 뉴스 (Plan 3)…"부터 `generateSectorNews(...)` 호출까지)를 교체:
```typescript
    // 섹터 찌라시 (v2): 진짜 이벤트 방향을 초반에 예고 + 이벤트 없는 섹터의 가짜 소문.
    // 실현 결과가 아니라 이벤트 의도 방향을 예고하므로 평균 등락 계산이 불필요하다.
    const allSectors = Array.from(new Set(biasTargets.map((t) => t.sector)));
    news.push(
      ...generateSectorRumors(
        sectorEvents,
        allSectors,
        config.ticksPerDay,
        tomorrowDate,
        config.openHour,
        rng
      )
    );
```
(`sectorLabelMap`/`closeByCode`가 이 블록에서만 쓰였다면 함께 제거. `sectorLabelMap` 로드부 `batchService.ts:109-115`도 다른 사용처가 없으면 삭제 — `grep -n sectorLabelMap src/services/batchService.ts`로 확인.)

- [ ] **Step 3: 빌드·린트**

Run: `npm run build && npm run lint`
Expected: 둘 다 통과. 미사용 import/변수 경고 0.

- [ ] **Step 4: 배치 스모크 (로컬 DB)**

Run:
```bash
npx supabase db reset
npm run dev &
sleep 6
curl -s -X POST "localhost:3000/api/cron/daily-batch?date=2026-07-31" -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -c \
"select grade, source, published_at from news where grade='rumor' and stock_code is null and date='2026-08-01' order by published_at;"
kill %1 2>/dev/null; pkill -f 'next dev' 2>/dev/null
```
Expected: 섹터 찌라시 행들이 `grade=rumor`·`source` 채워짐·`published_at`이 장 초반(개장~20%) 구간. (좀비 방지: 끝에 `pkill`. 날짜는 개장일 스케줄에 맞게 조정.)

- [ ] **Step 5: Commit**

```bash
git add src/services/batchService.ts
git commit -m "feat: 배치에서 섹터 찌라시 초반 생성으로 교체(후반 정식뉴스 제거)"
```

---

### Task 6: 밸런스 검증 (`scripts/simulate.ts`)

섹터 소문 추종 전략과 적중률 측정을 추가해, 적중률 55~70% + 추종 비지배를 확인하고 `fakeMin/fakeMax`·`RUMOR_WINDOW_RATIO`를 튜닝한다.

**Files:**
- Modify: `scripts/simulate.ts` (simulateMarket에 섹터 소문 노출 생성, STRATEGIES에 섹터추종 추가, main에 적중률 집계)

**Interfaces:**
- Consumes: `drawSectorEvents`(이미 import), `generateSectorRumors`(신규 import), STOCKS·섹터 매핑.
- Produces: 콘솔 출력에 `섹터소문 적중률: NN%`와 섹터추종 전략의 자산 분위수.

- [ ] **Step 1: simulateMarket에서 섹터 소문 재현**

`scripts/simulate.ts:106` 부근(sectorEvents 추첨 직후, 배치와 동일 순서)에서 `generateSectorRumors`를 호출해 그날 소문 목록과 방향을 `DayMarket`에 싣는다. 진짜/가짜·방향·대상 섹터를 전략이 읽을 수 있게 저장한다. 적중 판정용으로 각 소문의 (섹터, 예고방향)과 그 섹터 구성원 종가 평균 실제 방향을 함께 계산해 둔다.

- [ ] **Step 2: 섹터 소문 추종 전략 추가**

`STRATEGIES`에 추가 — "초반 소문이 up인 섹터 구성원을 개장가에 균등 매수, 종가 청산":
```typescript
{
  name: "섹터소문추종",
  run: (p, days) => {
    for (const day of days) {
      // 그날 up 소문 섹터의 구성원을 개장가 매수
      const upSectors = day.rumors.filter((r) => r.direction === "up").map((r) => r.sector);
      const targets = STOCKS.filter((s) => upSectors.includes(s.sector));
      if (targets.length > 0) {
        const budget = Math.floor(p.cash / targets.length);
        for (const s of targets) {
          const open = day.paths[s.code][0].price;
          buyAll({ ...p, cash: budget }, s.code, open); // 실제 시그니처에 맞게 조정
        }
      }
      // 종가 청산
      for (const code of Object.keys(p.holdings)) sellAll(p, code, day.closes[code]);
      payDividends(p, day);
    }
  },
},
```
(실제 `Strategy`/`Portfolio`/`DayMarket` 필드는 `simulate.ts:186-283`의 시그니처에 맞춘다. 위는 의도를 보이는 스켈레톤 — 기존 뉴스추종 전략 `simulate.ts:342-370` 패턴을 그대로 따른다.)

- [ ] **Step 3: 적중률 집계 출력**

`main()` 집계부에 소문 적중(예고 방향 == 섹터 평균 실제 방향) 카운트를 누적해 `적중률 = 맞음/전체`를 출력한다.

- [ ] **Step 4: 시뮬레이션 실행·판정**

Run: `npm run simulate -- --runs 2000`
Expected 확인 항목:
- `섹터소문 적중률`이 **55~70%** 범위. 벗어나면 `fakeMin/fakeMax`(가짜↑→적중↓) 조정 후 재실행.
- `섹터소문추종` 전략의 총자산 중앙값이 존버/본전 대비 **지배적이지 않음**(대략 중앙값 ≤ 1.1배). 지배적이면 `RUMOR_WINDOW_RATIO`를 키워(노출 후퇴) 재실행.

- [ ] **Step 5: 튜닝 결과를 코드에 반영**

시뮬레이션으로 확정한 `fakeMin/fakeMax`(generate.ts 기본값 또는 batchService 호출 인자)와 `RUMOR_WINDOW_RATIO`를 코드에 확정 반영하고, 근거 수치를 `generate.ts` 주석에 1줄 기록한다(기존 EARLY_SIGNAL 주석 관례).

- [ ] **Step 6: Commit**

```bash
git add scripts/simulate.ts src/lib/news/generate.ts
git commit -m "test: 시뮬레이터에 섹터소문 적중률·추종전략 추가, 밸런스 파라미터 확정"
```

---

### Task 7: 프론트 노출 확인 (`NewsList.tsx`)

섹터 찌라시(rumor + stock_code=null + source)가 피드에서 올바르게 렌더되는지 확인하고, 필요한 최소 수정만 한다.

**Files:**
- Inspect: `src/components/news/NewsList.tsx` (grade='rumor' 렌더, source 표기, stock_code=null 캐시태그 미부착)
- Inspect: `src/services/newsService.ts` (source 필드 select 포함 여부)

**Interfaces:**
- Consumes: DB `news` 행 (grade='rumor', stock_code=null, source).

- [ ] **Step 1: rumor 렌더·source select 확인**

Run:
```bash
grep -n "rumor\|source\|GRADE_META\|authorOf\|stockCode\|cashtag\|캐시태그" src/components/news/NewsList.tsx src/services/newsService.ts
```
`grade='rumor'`가 GRADE_META에 존재하고, `newsService`의 select에 `source`가 포함되는지 확인.

- [ ] **Step 2: 실제 앱 검증 (verify 스킬)**

`verify` 스킬(dev 서버 + agent-browser)로 `/news` 피드에서 섹터 찌라시가 (a) 미인증 찌라시 스타일, (b) source(찌라시꾼) 표기, (c) `$종목명` 캐시태그 없음으로 뜨는지 확인한다. 누락 시 최소 수정.

- [ ] **Step 3: 빌드·린트 최종**

Run: `npm run build && npm run lint`
Expected: 통과.

- [ ] **Step 4: Commit (수정이 있었다면)**

```bash
git add src/components/news/NewsList.tsx src/services/newsService.ts
git commit -m "fix: 섹터 찌라시 피드 렌더·source 표기 정합화"
```

---

## Self-Review

**Spec coverage:**
- 시세 엔진 불변 → Task 4/5(엔진 미변경 명시). ✅
- 진짜+가짜 소문 → Task 4. ✅
- 노출 초반 창 → Task 4 (RUMOR_WINDOW_RATIO). ✅
- grade=rumor·source·is_auto·stock_code=null → Task 1(DB source)·2(타입)·4(생성). ✅
- 문안 108개·찌라시꾼 → Task 3. ✅
- DB 마이그레이션 source → Task 1. ✅
- 밸런스 시뮬 55~70%·비지배 → Task 6. ✅
- 프론트 확인 → Task 7. ✅
- 제거 항목(generateSectorNews·SECTOR_NEWS_TEMPLATES·후반 노출) → Task 3·4·5. ✅

**Placeholder scan:** 문안 108개 중 4섹터(semiconductor/bio 완성 예시 + 형식)만 계획에 실었고 나머지 16섹터는 Task 3에서 "동일 밀도로 채움"으로 위임 — 이는 콘텐츠 분량상 불가피하며, 형식·톤·검수(Step 4/5)로 품질을 게이트한다. simulate 전략 스켈레톤은 "실제 시그니처에 맞게 조정" 단서를 달았다(기존 패턴 참조 지정).

**Type consistency:** `generateSectorRumors` 시그니처가 Task 4 정의·Task 5 호출·Task 6 사용에서 일치. `SectorRumorDirection`("up"|"down")이 Task 3·4에서 동일. `GeneratedNews.source`가 Task 2·4·DB(Task 1)에서 일치. `RUMORMONGERS`가 Task 3·4에서 일치.

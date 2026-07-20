// 뉴스 생성 로직 (T-502) — 순수 함수, 배치에서 호출
//
// 발행 정책 (사장님 확정 2026-07-14):
// - 정식뉴스(90%): 자동. 익일 사전생성 경로의 "실제 움직임"을 설명하는 뉴스로,
//   움직임이 대부분 끝난 뒤(장 후반) published_at을 스탬프해 장중 시간차로 노출된다
//   (사후 설명 = 따라 사도 이득 없음, tailNewsTick 참고). 10%는 반대 방향 오보.
// - 중립 잡뉴스(방향성 없음): 잔잔한 종목 중 랜덤으로 골라 장 초·중반(후반 전)에
//   균등 배치한다. 오르내림 신호가 없어 뉴스추종 악용이 불가하므로 순수 피드 밀도용
//   (하루 NEUTRAL_TARGET개, 균등 간격 ≈22분 ±5분 지터·종목 순서는 랜덤).
// - 종목 초반 톤뉴스 (Phase 3a, 2026-07-20 밸런스 결정 B): 기존 조기 방향뉴스(top-2·
//   장 70%지점·방향표시)를 실력자 우위 채널로 확장. 개별편향 |bias|≥STOCK_EARLY_CUT "진짜"
//   + 편향0 "필러"(진짜:노이즈 1:1)를 장 초반 0~STOCK_EARLY_WINDOW_RATIO 창에 분산 발행한다.
//   방향은 미표기 — 문안 톤이 진짜 방향을 STOCK_EARLY_TONE_ACC(0.6=애매)로만 가리켜, 톤 단독
//   추종은 동전(블라인드 사멸)이고 초반 시세 브레이크로 교차검증하는 실력자만 이득이다.
//   진짜/필러 모두 grade "news"라 라벨로는 구별 불가(문안 톤으로만). 이 종목들은 후반 정식뉴스
//   에서 제외한다. 거래량 단서 = 실제 틱 거래량(진짜=|bias| 큼→움직임 큼→거래량 실림)으로,
//   시세/차트에 이미 노출되므로 별도 저장이 불필요하다.
// - 헤드페이크 (Phase 3b): 편향0 종목 일부(진짜×0.3)를 tone-up "호재처럼" 발행하되, 경로는
//   펌프-덤프(generateHeadfakePath, randomWalk.ts)라 초반 확 튀었다 종가엔 꺼진다. 순진한
//   "초반 상승+호재톤" 추종을 유인하는 함정 — 단서는 얇은 거래량(펌프가 완만→거래량 조용).
//   실력은 "톤+시세브레이크+거래량"을 종합해 진짜 급등과 함정을 가른다. 하네스 검증
//   (288틱·수수료1.5%): 헤드페이크0=실력 상위4 68%(순진추종도 삶), 0.3=실력 40%·단타 23%
//   (순진추종 박살·다층 판단 요구), 0.5=과함(단타 역득세) → 0.3 스위트스팟 채택.
// - 찌라시(55%): 자동 생성하지 않는다. 어드민이 콘솔에서 직접 흘리고(수동), 그에
//   맞춰 시세를 조정한다.
// - 공시(오늘자, 100%): 실제 등락 ±5% 이상 또는 상·하한가만 발행. 폐장 시각에 노출.
// - 템플릿 재사용 금지: 이미 발행에 쓴 정식뉴스 템플릿은 제외하고 추첨한다.
//   풀 소진 시에만 전체 풀로 폴백.

import type { Rng } from "@/lib/engine/rng";
import { TICK_INTERVAL_SECONDS, tickTimestamp } from "@/lib/market";
import type { NewsGrade } from "@/types/domain";
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

export interface GeneratedNews {
  date: string;
  stockCode: string | null;
  grade: NewsGrade;
  title: string;
  body: string;
  source?: string | null; // 제보자·매체 (섹터 찌라시만 사용, 나머지는 undefined→null)
  publishedAt: string; // ISO timestamptz — 이 시각부터 피드에 노출
}

const COVERAGE = 0.7; // 유의미한 움직임 중 뉴스가 붙는 비율 (나머지는 조용히 지나감)
const NEWS_ACCURACY = 0.9; // 정식뉴스가 실제 방향과 일치할 확률

// 종목 초반 톤뉴스 채널 (Phase 3a 확정값 2026-07-20) — 상세 근거는 파일 상단 참고
export const STOCK_EARLY_CUT = 20; // 진짜 대상: |개별 bias| ≥ 20 (하네스 STOCKNEWS_CUT)
const STOCK_EARLY_TONE_ACC = 0.6; // 톤이 진짜 방향을 가리킬 확률 (0.6=애매, 톤 단독 추종 무력화)
const STOCK_EARLY_NOISE_RATIO = 1.0; // 진짜당 필러(방향성0 종목) 수 (진짜:노이즈 = 1:1)
const STOCK_EARLY_HEADFAKE_RATIO = 0.3; // 진짜당 헤드페이크(펌프-덤프 함정) 수 (하네스 스위트스팟, Phase 3b)
const STOCK_EARLY_WINDOW_RATIO = 0.4; // 발행 창 = 장 0~40% 지점 (교차검증할 남은 움직임 확보)
const STOCK_EARLY_FILLER_LEVEL = 10 as const; // 필러 톤 세기(약) — 방향성0이라 세기 정보 없음
const STOCK_EARLY_HEADFAKE_LEVEL = 10 as const; // 헤드페이크 톤 세기(약, 항상 tone-up=호재처럼)
// 발행 슬롯 지터 — 벽시계 ±5분어치 틱(틱 간격 무관하게 분산 폭 보존)
const STOCK_EARLY_JITTER_TICKS = Math.round((5 * 60) / TICK_INTERVAL_SECONDS);
const NEUTRAL_TARGET = 27; // 초·중반에 균등 배치할 중립 잡뉴스 목표 개수/일 = 가용 중립 종목 전부 (약 22분 간격, 방향성 없음·피드 밀도용)
// 틱 간격이 바뀌어도(5분→10초 등) 벽시계 지속시간을 보존하도록 TICK_INTERVAL_SECONDS로 재유도한다.
const NEUTRAL_JITTER_TICKS = Math.round((5 * 60) / TICK_INTERVAL_SECONDS); // 균등 간격에서 ±5분어치 틱 흔들어 기계적 등간격 방지
const STEEP_WINDOW = Math.round((15 * 60) / TICK_INTERVAL_SECONDS); // 가파른 구간 탐지 창 (벽시계 15분)

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// rng 기반 Fisher-Yates 셔플 (원본 불변) — 중립 잡뉴스 종목 순서 무작위화에 사용
function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function levelOf(signedMagnitude: number): BiasLevel {
  return String(signedMagnitude) as BiasLevel;
}

// 결합 편향(개별 이벤트 + 섹터 참여분 ±15%p)은 템플릿 세기(10/20/30)와 정확히
// 일치하지 않을 수 있어(예: 10+15=25, 20-15=5) 가장 가까운 세기로 스냅한다.
// 순수 개별 이벤트(10/20/30)는 그대로 자기 자신에 스냅되어 기존 동작과 동일하다.
function snapMagnitudeLevel(magnitude: number): 10 | 20 | 30 {
  if (magnitude < 15) return 10;
  if (magnitude < 25) return 20;
  return 30;
}

// 종목별 발행 이력 (제목 → 누적 사용 횟수) — 순환 추첨에 사용
export type UsedTitles = Record<string, ReadonlyMap<string, number>>;

// 사용 횟수가 가장 적은 템플릿들 중에서 랜덤 추첨.
//   한 바퀴(풀 전체를 1회씩) 다 쓰면 최소 횟수가 올라가 자동으로 새 사이클이 시작되고,
//   각 사이클 안에서는 아직 덜 쓴 것들만 후보라 매번 새로운 랜덤 순서로 한 바퀴를 돈다.
function pickUnused(
  rng: Rng,
  pool: readonly NewsTemplate[],
  used: ReadonlyMap<string, number> | undefined
): NewsTemplate {
  if (!used || used.size === 0) return pick(rng, pool);
  let minCount = Infinity;
  for (const t of pool) {
    const c = used.get(t.title) ?? 0;
    if (c < minCount) minCount = c;
  }
  const fresh = pool.filter((t) => (used.get(t.title) ?? 0) === minCount);
  return pick(rng, fresh.length > 0 ? fresh : pool);
}

// 정식뉴스 생성을 위한 종목별 익일 경로 (배치가 생성한 사전 경로)
export interface StockDayPath {
  code: string;
  prevClose: number; // 직전 종가 (등락률 기준)
  ticks: { tickIndex: number; price: number }[];
}

// |등락률| → 사건 세기(10/20/30). 5% 미만은 뉴스거리 아님(0).
// scale: 판정 구간이 하루보다 짧을 때(시세 조정 꼬리 등) 임계값을 비례 축소한다.
//   예: 꼬리가 장의 절반이면 scale=0.5 → 임계 2.5/6/10%. 템플릿은 퍼센트가 아닌
//   "재료의 세기"(소소/큰/초대형)만 표현하므로 임계를 낮춰도 문구 모순이 없다.
function magnitudeLevel(absPct: number, scale: number = 1): 0 | 10 | 20 | 30 {
  if (absPct >= 20 * scale) return 30;
  if (absPct >= 12 * scale) return 20;
  if (absPct >= 5 * scale) return 10;
  return 0;
}

// 경로에서 가장 가파른 구간의 배열 인덱스 (움직임이 "터지는" 순간)
function steepestArrayIndex(ticks: { tickIndex: number; price: number }[]): number {
  if (ticks.length <= STEEP_WINDOW) return ticks.length - 1;
  let bestIdx = STEEP_WINDOW;
  let bestAbs = -1;
  for (let i = STEEP_WINDOW; i < ticks.length; i++) {
    const delta = Math.abs(ticks[i].price - ticks[i - STEEP_WINDOW].price);
    if (delta > bestAbs) {
      bestAbs = delta;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// 정식뉴스 노출 틱 = "움직임이 대부분 끝난 뒤" (사후 설명, 뉴스추종 이득 제거).
//   steepest 지점 이후 & 장 후반(TAIL_MIN_RATIO) 이후 중 더 늦은 쪽에 스탬프한다.
//   - steepest 이후: 뉴스가 움직임보다 먼저 뜨는 사고 방지 (항상 사후)
//   - 후반 이후: 움직임이 일찍 끝난 날에도 따라 살 남은 드리프트를 없앰
//   시뮬레이션 검증(2026-07-14): 뉴스추종 중앙값 1.01배(본전). middle 배치는
//   오히려 1.28배로 역효과라 반드시 후반부로 민다.
const TAIL_MIN_RATIO = 0.85;
function tailNewsTick(ticks: { tickIndex: number; price: number }[]): number {
  const last = ticks.length - 1;
  if (last <= 0) return ticks[last]?.tickIndex ?? 0;
  const idx = Math.max(steepestArrayIndex(ticks), Math.floor(last * TAIL_MIN_RATIO));
  return ticks[idx].tickIndex;
}

// 익일 정식뉴스 — 사전 경로의 실제 움직임을 설명하는 뉴스 (장중 시간차 노출)
export function generateRegularNews(
  paths: StockDayPath[],
  date: string,
  openHour: number,
  rng: Rng,
  usedTitles: UsedTitles = {},
  scale: number = 1, // 판정 구간이 하루보다 짧을 때 임계값 비례 축소 (시세 조정 꼬리)
  neutralTarget: number = NEUTRAL_TARGET, // 초·중반에 균등 배치할 중립 잡뉴스 수 (0이면 배치 안 함)
  excludeCodes: ReadonlySet<string> = new Set() // 조기 방향뉴스가 이미 붙은 종목 (중복 방지)
): GeneratedNews[] {
  const result: GeneratedNews[] = [];
  // 방향성 없는 종목 후보 — 전량 모아 두었다가 아래에서 초·중반에 균등 배치한다
  const neutral: {
    path: StockDayPath;
    templates: Record<BiasLevel, NewsTemplate[]>;
    used: ReadonlyMap<string, number> | undefined;
  }[] = [];

  for (const path of paths) {
    if (excludeCodes.has(path.code)) continue; // 조기 방향뉴스 종목은 후반 정식뉴스에서 제외
    const templates = HINT_TEMPLATES[path.code];
    if (!templates || path.ticks.length === 0) continue;
    const used = usedTitles[path.code];

    const closePrice = path.ticks[path.ticks.length - 1].price;
    const dayChangePct = ((closePrice - path.prevClose) / path.prevClose) * 100;
    const magnitude = magnitudeLevel(Math.abs(dayChangePct), scale);

    if (magnitude === 0) {
      neutral.push({ path, templates, used }); // 배치는 아래에서 일괄 (균등 분산)
      continue;
    }

    // 유의미한 움직임: 일부는 뉴스 없이 지나간다
    if (rng() >= COVERAGE) continue;

    const actualDir = dayChangePct >= 0 ? 1 : -1;
    const shownDir = rng() < NEWS_ACCURACY ? actualDir : -actualDir; // 10% 오보
    const template = pickUnused(rng, templates[levelOf(shownDir * magnitude)], used);
    const tick = tailNewsTick(path.ticks); // 움직임이 대부분 끝난 뒤 노출 (사후 설명)
    result.push({
      date,
      stockCode: path.code,
      grade: "news",
      ...template,
      publishedAt: tickTimestamp(date, tick, openHour),
    });
  }

  // 중립 잡뉴스: 랜덤 순서로 최대 neutralTarget개를 골라 장 초·중반에 균등 배치.
  //   방향성이 없어 뉴스추종 악용이 불가 → 후반부 격리 없이 앞·중반 밀도만 채운다.
  const picked = shuffle(rng, neutral).slice(0, Math.max(0, neutralTarget));
  const n = picked.length;
  for (let i = 0; i < n; i++) {
    const { path, templates, used } = picked[i];
    // 장 후반(tailNewsTick 구간, TAIL_MIN_RATIO~) 직전까지가 중립 배치 범위
    const cutoffIdx = Math.max(1, Math.floor((path.ticks.length - 1) * TAIL_MIN_RATIO));
    // 슬롯 중앙(균등 간격 ≈22분)에서 ±NEUTRAL_JITTER_TICKS틱(±5분)만 흔든다.
    //   슬롯 전체 랜덤이면 간격이 5~35분으로 들쭉날쭉 → 중앙 고정+소량 지터로 규칙적이되 등간격은 아니게.
    const center = (cutoffIdx * (i + 0.5)) / n;
    const jitter =
      Math.floor(rng() * (2 * NEUTRAL_JITTER_TICKS + 1)) - NEUTRAL_JITTER_TICKS;
    const arrIdx = Math.max(0, Math.min(cutoffIdx - 1, Math.round(center) + jitter));
    const template = pickUnused(rng, templates["0"], used);
    result.push({
      date,
      stockCode: path.code,
      grade: "news",
      ...template,
      publishedAt: tickTimestamp(date, path.ticks[arrIdx].tickIndex, openHour),
    });
  }

  return result;
}

export interface StockNewsTargets {
  reals: string[]; // |개별 bias| ≥ CUT — 톤이 진짜 방향을 힌트, 실제로 크게 움직임(거래량 실림)
  fillers: string[]; // 편향0 종목 — 톤 랜덤(방향성0 노이즈), 실제 움직임 없음
  headfakes: string[]; // 편향0 종목 — tone-up 호재처럼 펌프했다 종가에 덤프(펌프-덤프 함정, Phase 3b)
}

// 종목 초반 톤뉴스 대상 선정 (Phase 3a·3b):
//   진짜 = 개별 편향 |bias|≥CUT (코드 사전순으로 결정적 — 배치 멱등성 유지)
//   헤드페이크 = 편향0 종목 중 진짜수 × HEADFAKE_RATIO개 랜덤 추출 (Phase 3b, tone-up 함정)
//   필러 = 남은 편향0 종목 중 진짜수 × NOISE_RATIO개 랜덤 추출 (진짜:노이즈 1:1)
//   RNG 소비 순서: 헤드페이크 추출 → 필러 추출 (진짜는 소비 없음). 헤드페이크를 먼저 뽑아
//   같은 pool에서 겹치지 않게 한다(하네스 drawStockNews와 동일 순서). batchService가 이 함수를
//   경로 루프 前에 호출해 headfakes를 펌프-덤프 경로 대상으로 쓰므로 순서·시드가 재현돼야 한다.
export function pickStockNewsTargets(
  individualBiases: Record<string, number>,
  rng: Rng
): StockNewsTargets {
  const reals: string[] = [];
  const pool: string[] = []; // 편향0 종목 = 헤드페이크·필러 후보
  for (const [code, b] of Object.entries(individualBiases).sort((a, z) =>
    a[0] < z[0] ? -1 : 1
  )) {
    if (Math.abs(b) >= STOCK_EARLY_CUT) reals.push(code);
    else if (b === 0) pool.push(code);
  }
  const draw = (): string | null =>
    pool.length ? pool.splice(Math.floor(rng() * pool.length), 1)[0] : null;

  const headfakeCount = Math.min(
    pool.length,
    Math.round(reals.length * STOCK_EARLY_HEADFAKE_RATIO)
  );
  const headfakes: string[] = [];
  for (let i = 0; i < headfakeCount; i++) {
    const code = draw();
    if (code) headfakes.push(code);
  }

  const fillerCount = Math.min(
    pool.length,
    Math.round(reals.length * STOCK_EARLY_NOISE_RATIO)
  );
  const fillers: string[] = [];
  for (let i = 0; i < fillerCount; i++) {
    const code = draw();
    if (code) fillers.push(code);
  }
  return { reals, fillers, headfakes };
}

// 종목 초반 톤뉴스 발행 (Phase 3a·3b) — 진짜+헤드페이크+필러를 장 0~WINDOW 창에 방향 미표기(톤만)로 분산.
//   진짜: 세기(10/20/30)=개별 편향 크기, 톤 방향=진짜 방향을 TONE_ACC로만 일치(아니면 반대) = 애매.
//   헤드페이크: 세기=약(10), 톤=항상 up(호재처럼) — 경로는 펌프-덤프(generateHeadfakePath)라 종가엔 꺼진다.
//   필러: 세기=약(10), 톤 방향=랜덤 → 방향성0 노이즈(블라인드 추종을 동전으로 만든다).
//   grade는 정식뉴스와 동일한 "news"라 라벨 구별 불가, 문안 톤으로만 티가 난다. 실력 = 톤 +
//   초반 시세 브레이크 + 거래량(진짜=실림 / 헤드페이크=얇음) 교차검증.
export function generateStockEarlyNews(
  paths: StockDayPath[],
  targets: StockNewsTargets,
  individualBiases: Record<string, number>,
  date: string,
  openHour: number,
  rng: Rng,
  usedTitles: UsedTitles = {}
): GeneratedNews[] {
  const pathByCode = new Map(paths.map((p) => [p.code, p]));
  const totalTicks = paths.reduce((m, p) => Math.max(m, p.ticks.length), 0);
  if (totalTicks === 0) return [];
  const windowTicks = Math.max(1, Math.floor(totalTicks * STOCK_EARLY_WINDOW_RATIO));

  // 발행 항목 구성 — 진짜(코드순) → 헤드페이크 → 필러(추출 순서) 순. 톤 방향·세기를 여기서 결정한다.
  //   RNG 소비: 진짜당 1회(톤 플립 판정) + 필러당 1회(랜덤 방향). 헤드페이크는 톤 고정(up)이라 미소비.
  //   슬롯 배치에서 항목당 추가 1회 소비(지터).
  const items: Array<{ code: string; level: 10 | 20 | 30; dir: 1 | -1 }> = [];
  for (const code of targets.reals) {
    const path = pathByCode.get(code);
    if (!path || !HINT_TEMPLATES[code] || path.ticks.length === 0) continue;
    const magnitude = Math.abs(individualBiases[code] ?? 0);
    if (magnitude === 0) continue;
    const trueDir: 1 | -1 = (individualBiases[code] ?? 0) > 0 ? 1 : -1;
    const shownDir: 1 | -1 = rng() < STOCK_EARLY_TONE_ACC ? trueDir : ((-trueDir) as 1 | -1);
    items.push({ code, level: snapMagnitudeLevel(magnitude), dir: shownDir });
  }
  for (const code of targets.headfakes) {
    const path = pathByCode.get(code);
    if (!path || !HINT_TEMPLATES[code] || path.ticks.length === 0) continue;
    // 헤드페이크는 항상 tone-up(호재처럼) — 초반 펌프와 맞물려 순진한 추종을 유인한다.
    items.push({ code, level: STOCK_EARLY_HEADFAKE_LEVEL, dir: 1 });
  }
  for (const code of targets.fillers) {
    const path = pathByCode.get(code);
    if (!path || !HINT_TEMPLATES[code] || path.ticks.length === 0) continue;
    const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
    items.push({ code, level: STOCK_EARLY_FILLER_LEVEL, dir });
  }

  // 0~WINDOW 창에 균등 슬롯 + ±JITTER 분산 (개장 직후 한 틱 몰림 방지 — 잡뉴스·소문과 동일 패턴)
  const n = items.length;
  const result: GeneratedNews[] = [];
  for (let i = 0; i < n; i++) {
    const { code, level, dir } = items[i];
    const path = pathByCode.get(code)!;
    const template = pickUnused(
      rng,
      HINT_TEMPLATES[code][levelOf(dir * level)],
      usedTitles[code]
    );
    const center = Math.floor((windowTicks * (i + 0.5)) / n);
    const jitter =
      Math.floor(rng() * (2 * STOCK_EARLY_JITTER_TICKS + 1)) - STOCK_EARLY_JITTER_TICKS;
    const cap = Math.min(windowTicks, path.ticks.length - 1);
    const arrIdx = Math.max(0, Math.min(cap, center + jitter));
    result.push({
      date,
      stockCode: code,
      grade: "news",
      ...template,
      publishedAt: tickTimestamp(date, path.ticks[arrIdx].tickIndex, openHour),
    });
  }
  return result;
}

// 섹터 찌라시 (섹터 개편 v2, spec 2026-07-17): 장 초반 예고성 소문.
// 진짜 = 이벤트 방향 그대로 예고(참여확률 탓 자연 적중<100%). 가짜 = 이벤트 없는 섹터
// 랜덤 fakeMin~fakeMax개를 랜덤 방향으로 예고. grade='rumor'(55%)·stock_code=null.
// 노출은 장 초반 창(0~RUMOR_WINDOW_RATIO)에 균등+지터 분산. source=찌라시꾼 랜덤.
// 초반 노출 창 상한 (0~20% 지점). 시뮬 2000회(2026-07-17): 적중 55.1%(진짜 61%/가짜 50%)·
// 하루 2.8개, 섹터소문추종 중앙값 10.92배(존버 대비 +7~11% 약우위·비지배)로 현행 확정(사장님 승인).
const RUMOR_WINDOW_RATIO = 0.2;
// 초반 창 슬롯 지터 — 벽시계 ±5분어치 틱으로 스케일(틱 간격 무관하게 분산 폭 보존).
const RUMOR_JITTER_TICKS = Math.round((5 * 60) / TICK_INTERVAL_SECONDS);

function dirKey(direction: number): SectorRumorDirection {
  return direction >= 0 ? "up" : "down";
}

// 추첨된 섹터 소문 한 건 (뉴스 렌더 전 메타). 시뮬레이터가 적중률·추종 전략에 쓴다.
export interface SectorRumor {
  sector: string; // 섹터 코드
  direction: SectorRumorDirection; // 예고 방향
  isFake: boolean; // true=이벤트 없는 섹터의 헛소문, false=진짜 이벤트 방향
}

// 진짜(이벤트 방향 예고) + 가짜(이벤트 없는 섹터 랜덤 방향) 소문을 추첨한다.
// RNG 소비: 가짜 개수 1회 + 가짜당 (섹터 선택 1 + 방향 1). 진짜 소문은 RNG를 쓰지 않는다.
// batchService·simulate가 이 순수 함수를 공유해 추첨 결과를 일치시킨다.
export function drawSectorRumors(
  events: SectorEvent[],
  allSectors: string[],
  rng: Rng,
  fakeMin: number = 1,
  fakeMax: number = 2
): SectorRumor[] {
  // 진짜 소문: 이벤트 방향 예고
  const rumors: SectorRumor[] = events
    .filter((e) => SECTOR_RUMOR_TEMPLATES[e.sector])
    .map((e) => ({ sector: e.sector, direction: dirKey(e.direction), isFake: false }));

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
    rumors.push({ sector, direction, isFake: true });
  }
  return rumors;
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
  const rumors = drawSectorRumors(events, allSectors, rng, fakeMin, fakeMax);

  // 초반 창에 균등 슬롯 + ±RUMOR_JITTER_TICKS(벽시계 ±5분)로 분산 (개장 직후 한 틱 몰림 방지)
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
    const jitter =
      Math.floor(rng() * (2 * RUMOR_JITTER_TICKS + 1)) - RUMOR_JITTER_TICKS; // -RUMOR_JITTER_TICKS..+RUMOR_JITTER_TICKS
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

export interface DailyMove {
  code: string;
  name: string;
  changePercent: number; // 전일 종가 대비 %
  isLimitUp: boolean;
  isLimitDown: boolean;
}

// 오늘자 공시 (실제 결과 — 급등락·상하한만)
// publishedAt은 폐장 직전 틱 시각 = 폐장 순간에 노출된다 (설정된 폐장 시각 기준).
export function generateDisclosures(
  moves: DailyMove[],
  date: string,
  publishedAt: string,
  rng: Rng
): GeneratedNews[] {
  const result: GeneratedNews[] = [];

  for (const move of moves) {
    let kind: DisclosureKind | null = null;
    if (move.isLimitUp) kind = "limitUp";
    else if (move.isLimitDown) kind = "limitDown";
    else if (move.changePercent >= 5) kind = "surge";
    else if (move.changePercent <= -5) kind = "plunge";
    if (!kind) continue;

    const template = pick(rng, DISCLOSURE_TEMPLATES[kind]);
    const pct = String(Math.abs(move.changePercent) * (move.changePercent < 0 ? -1 : 1));
    result.push({
      date,
      stockCode: move.code,
      grade: "disclosure",
      title: template.title.replaceAll("{name}", move.name).replaceAll("{pct}", pct),
      body: template.body.replaceAll("{name}", move.name).replaceAll("{pct}", pct),
      publishedAt,
    });
  }

  return result;
}

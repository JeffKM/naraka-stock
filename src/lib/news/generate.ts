// 뉴스 생성 로직 (T-502) — 순수 함수, 배치에서 호출
//
// 발행 정책 (사장님 확정 2026-07-14):
// - 정식뉴스(90%): 자동. 익일 사전생성 경로의 "실제 움직임"을 설명하는 뉴스로,
//   움직임이 대부분 끝난 뒤(장 후반) published_at을 스탬프해 장중 시간차로 노출된다
//   (사후 설명 = 따라 사도 이득 없음, tailNewsTick 참고). 10%는 반대 방향 오보.
// - 중립 잡뉴스(방향성 없음): 잔잔한 종목 중 랜덤으로 골라 장 초·중반(후반 전)에
//   균등 배치한다. 오르내림 신호가 없어 뉴스추종 악용이 불가하므로 순수 피드 밀도용
//   (하루 NEUTRAL_TARGET개, 균등 간격 ≈22분 ±5분 지터·종목 순서는 랜덤).
// - 장중 조기 방향뉴스(2026-07-15 추가): 매일 편향 이벤트 상위 EARLY_SIGNAL_COUNT종에
//   대해, 방향이 있는 뉴스를 장 EARLY_SIGNAL_RATIO 지점(후반 전)에 흘린다. 잡뉴스와
//   겉모습(grade "news")은 같고 문안 톤(방향 템플릿)으로만 구별되어, 손님이 피드를
//   읽고 판별해 베팅하는 재미를 준다. 방향은 "노출 틱→종가 실제 방향"과
//   EARLY_SIGNAL_ACCURACY 확률로만 일치(=도박). 이 종목은 후반 정식뉴스에서 제외한다.
//   시뮬레이션 검증(2026-07-15): 2종·정확도 60%·0.7 지점이 밸런스(추종 중앙값 ≈본전,
//   존버·잡주몰빵 미지배)와 차별화(원금손실 45%·상하 스프레드 2.2배)를 동시에 만족.
//   더 이르거나(장 중간) 더 정확하면(≥70%) 추종이 지배 전략이 되어 붕괴한다.
// - 찌라시(55%): 자동 생성하지 않는다. 어드민이 콘솔에서 직접 흘리고(수동), 그에
//   맞춰 시세를 조정한다.
// - 공시(오늘자, 100%): 실제 등락 ±5% 이상 또는 상·하한가만 발행. 폐장 시각에 노출.
// - 템플릿 재사용 금지: 이미 발행에 쓴 정식뉴스 템플릿은 제외하고 추첨한다.
//   풀 소진 시에만 전체 풀로 폴백.

import type { Rng } from "@/lib/engine/rng";
import { tickTimestamp } from "@/lib/market";
import type { NewsGrade } from "@/types/domain";
import {
  DISCLOSURE_TEMPLATES,
  HINT_TEMPLATES,
  SECTOR_NEWS_TEMPLATES,
  type BiasLevel,
  type DisclosureKind,
  type NewsTemplate,
  type SectorNewsGrade,
} from "./templates";

export interface GeneratedNews {
  date: string;
  stockCode: string | null;
  grade: NewsGrade;
  title: string;
  body: string;
  publishedAt: string; // ISO timestamptz — 이 시각부터 피드에 노출
}

const COVERAGE = 0.7; // 유의미한 움직임 중 뉴스가 붙는 비율 (나머지는 조용히 지나감)
const NEWS_ACCURACY = 0.9; // 정식뉴스가 실제 방향과 일치할 확률

// 장중 조기 방향뉴스 (시뮬레이션 확정값 2026-07-15) — 상세 근거는 파일 상단 참고
export const EARLY_SIGNAL_COUNT = 2; // 하루 조기 방향뉴스 개수 (편향 이벤트 상위 N종)
const EARLY_SIGNAL_ACCURACY = 0.6; // 노출 틱→종가 실제 방향과 일치할 확률 (아니면 반대)
const EARLY_SIGNAL_RATIO = 0.7; // 노출 틱 = 장 70% 지점 (남은 드리프트만 추종 가능 → 착취 제한)
const NEUTRAL_TARGET = 27; // 초·중반에 균등 배치할 중립 잡뉴스 목표 개수/일 = 가용 중립 종목 전부 (약 22분 간격, 방향성 없음·피드 밀도용)
const NEUTRAL_JITTER_TICKS = 1; // 균등 간격에서 ±1틱(=±5분, 틱 간격 5분 기준) 흔들어 기계적 등간격 방지
const STEEP_WINDOW = 3; // 가파른 구간 탐지 창 (3틱 = 15분)

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

// 조기 방향뉴스 대상 선정: 그날 편향 이벤트(bias≠0) 중 |bias| 상위 count종.
//   동률은 코드 사전순으로 tie-break해 결정적(배치 멱등성 유지).
export function pickEarlySignalTargets(
  biases: Record<string, number>,
  count: number = EARLY_SIGNAL_COUNT
): string[] {
  return Object.entries(biases)
    .filter(([, b]) => b !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, count)
    .map(([code]) => code);
}

// 장중 조기 방향뉴스 — 잡뉴스 사이에 소수(EARLY_SIGNAL_COUNT) 섞는 "예측형" 신호.
//   세기(±10/20/30)는 재료(bias) 크기로, 부호는 "노출 틱→종가 실제 방향"과
//   EARLY_SIGNAL_ACCURACY 확률로 일치(아니면 반대)해 정한다 = 정확도 있는 도박 신호.
//   노출 틱은 장 EARLY_SIGNAL_RATIO 지점(후반 전) — 남은 움직임만 추종 가능해 착취 제한.
//   grade는 잡뉴스와 동일한 "news"라 라벨로는 구별 불가, 문안 톤으로만 티가 난다.
export function generateEarlySignalNews(
  paths: StockDayPath[],
  targets: string[],
  biases: Record<string, number>,
  date: string,
  openHour: number,
  rng: Rng,
  usedTitles: UsedTitles = {}
): GeneratedNews[] {
  const result: GeneratedNews[] = [];
  const pathByCode = new Map(paths.map((p) => [p.code, p]));
  for (const code of targets) {
    const path = pathByCode.get(code);
    const templates = HINT_TEMPLATES[code];
    if (!path || !templates || path.ticks.length === 0) continue;
    const magnitude = Math.abs(biases[code]); // 개별+섹터 결합 편향 (10/20/30이 아닐 수 있음)
    if (magnitude === 0) continue;
    const level = snapMagnitudeLevel(magnitude); // 템플릿 세기(10/20/30)로 스냅

    const last = path.ticks.length - 1;
    const idx = Math.min(last, Math.max(0, Math.floor(last * EARLY_SIGNAL_RATIO)));
    const entryPrice = path.ticks[idx].price;
    const closePrice = path.ticks[last].price;
    const actualDir = closePrice >= entryPrice ? 1 : -1; // 노출 틱→종가 실제 방향
    const shownDir = rng() < EARLY_SIGNAL_ACCURACY ? actualDir : -actualDir;
    const template = pickUnused(
      rng,
      templates[levelOf(shownDir * level)],
      usedTitles[code]
    );
    result.push({
      date,
      stockCode: code,
      grade: "news",
      ...template,
      publishedAt: tickTimestamp(date, path.ticks[idx].tickIndex, openHour),
    });
  }
  return result;
}

// 섹터 뉴스 (섹터 개편 Plan 3, 스펙 §4.4): 섹터 이벤트를 설명하는 정식뉴스.
// 이벤트당 1건(stock_code=null, 섹터 전체). 세기는 그 섹터 구성원의 실현 일간 평균
// 등락으로 등급화하고, 방향은 실현 결과 기준이다. 노출은 정식뉴스와 동일하게 장
// 후반(0.8 지점) — 사후 설명이라 추종 이득이 없다. 라벨은 sectors.label_ko를 주입받는다.
export interface SectorNewsInput {
  sector: string; // 섹터 코드
  avgChangePercent: number; // 그 섹터 구성원의 실현 평균 등락률(%)
}

// 실현 평균 등락률 → 등급. 임계 ±4%(콘텐츠 파라미터, 밸런스 무관).
function gradeSector(avg: number): SectorNewsGrade {
  if (avg >= 4) return "surgeUp";
  if (avg >= 0) return "up";
  if (avg > -4) return "down";
  return "plungeDown";
}

// 섹터 이벤트 목록 → 섹터 뉴스 다건. 라벨맵으로 코드→한국어 치환.
export function generateSectorNews(
  inputs: SectorNewsInput[],
  labelMap: Record<string, string>,
  totalTicks: number,
  tomorrowDate: string,
  openHour: number,
  rng: Rng
): GeneratedNews[] {
  const tick = Math.min(totalTicks - 1, Math.floor(totalTicks * 0.8));
  // 같은 등급이 여러 건이면 같은 배치 안에서 제목 중복을 피한다.
  const usedByGrade: Record<SectorNewsGrade, Map<string, number>> = {
    surgeUp: new Map(),
    up: new Map(),
    down: new Map(),
    plungeDown: new Map(),
  };
  return inputs.map((input) => {
    const label = labelMap[input.sector] ?? input.sector;
    const grade = gradeSector(input.avgChangePercent);
    const used = usedByGrade[grade];
    const tmpl = pickUnused(rng, SECTOR_NEWS_TEMPLATES[grade], used);
    used.set(tmpl.title, (used.get(tmpl.title) ?? 0) + 1);
    return {
      date: tomorrowDate,
      stockCode: null,
      grade: "news" as const,
      title: tmpl.title.replaceAll("{sector}", label),
      body: tmpl.body.replaceAll("{sector}", label),
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

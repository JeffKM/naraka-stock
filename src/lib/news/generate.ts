// 뉴스 생성 로직 (T-502) — 순수 함수, 배치에서 호출
//
// 발행 정책 (사장님 확정 2026-07-14):
// - 정식뉴스(90%): 자동. 익일 사전생성 경로의 "실제 움직임"을 설명하는 뉴스로,
//   가장 가파른 움직임이 나오는 틱 시각에 published_at을 스탬프해 장중 시간차로
//   노출된다 (움직임과 동시 = 설명형). 10%는 반대 방향 오보.
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
  type BiasLevel,
  type DisclosureKind,
  type NewsTemplate,
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
const NEUTRAL_NOISE_PROB = 0.12; // 잔잔한 종목의 방향성 없는 잡뉴스
const STEEP_WINDOW = 3; // 가파른 구간 탐지 창 (3틱 = 15분)

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function levelOf(signedMagnitude: number): BiasLevel {
  return String(signedMagnitude) as BiasLevel;
}

// 종목별 발행 이력 (제목 집합) — 재사용 금지 추첨에 사용
export type UsedTitles = Record<string, ReadonlySet<string>>;

// 사용 이력을 제외한 풀에서 추첨. 소진 시 전체 풀 폴백
function pickUnused(
  rng: Rng,
  pool: readonly NewsTemplate[],
  used: ReadonlySet<string> | undefined
): NewsTemplate {
  const fresh = used ? pool.filter((t) => !used.has(t.title)) : pool;
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

// 경로에서 가장 가파른 구간의 틱 인덱스 (뉴스가 "터지는" 순간)
function steepestTickIndex(ticks: { tickIndex: number; price: number }[]): number {
  if (ticks.length <= STEEP_WINDOW) return ticks[ticks.length - 1]?.tickIndex ?? 0;
  let bestIdx = ticks[STEEP_WINDOW].tickIndex;
  let bestAbs = -1;
  for (let i = STEEP_WINDOW; i < ticks.length; i++) {
    const delta = Math.abs(ticks[i].price - ticks[i - STEEP_WINDOW].price);
    if (delta > bestAbs) {
      bestAbs = delta;
      bestIdx = ticks[i].tickIndex;
    }
  }
  return bestIdx;
}

// 익일 정식뉴스 — 사전 경로의 실제 움직임을 설명하는 뉴스 (장중 시간차 노출)
export function generateRegularNews(
  paths: StockDayPath[],
  date: string,
  openHour: number,
  rng: Rng,
  usedTitles: UsedTitles = {},
  scale: number = 1 // 판정 구간이 하루보다 짧을 때 임계값 비례 축소 (시세 조정 꼬리)
): GeneratedNews[] {
  const result: GeneratedNews[] = [];

  for (const path of paths) {
    const templates = HINT_TEMPLATES[path.code];
    if (!templates || path.ticks.length === 0) continue;
    const used = usedTitles[path.code];

    const closePrice = path.ticks[path.ticks.length - 1].price;
    const dayChangePct = ((closePrice - path.prevClose) / path.prevClose) * 100;
    const magnitude = magnitudeLevel(Math.abs(dayChangePct), scale);

    if (magnitude === 0) {
      // 잔잔한 종목: 가끔 방향성 없는 잡뉴스만 (임의 틱 배치)
      if (rng() < NEUTRAL_NOISE_PROB) {
        const template = pickUnused(rng, templates["0"], used);
        const tick = path.ticks[Math.floor(rng() * path.ticks.length)].tickIndex;
        result.push({
          date,
          stockCode: path.code,
          grade: "news",
          ...template,
          publishedAt: tickTimestamp(date, tick, openHour),
        });
      }
      continue;
    }

    // 유의미한 움직임: 일부는 뉴스 없이 지나간다
    if (rng() >= COVERAGE) continue;

    const actualDir = dayChangePct >= 0 ? 1 : -1;
    const shownDir = rng() < NEWS_ACCURACY ? actualDir : -actualDir; // 10% 오보
    const template = pickUnused(rng, templates[levelOf(shownDir * magnitude)], used);
    const tick = steepestTickIndex(path.ticks); // 움직임과 동시에 터진다
    result.push({
      date,
      stockCode: path.code,
      grade: "news",
      ...template,
      publishedAt: tickTimestamp(date, tick, openHour),
    });
  }

  return result;
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

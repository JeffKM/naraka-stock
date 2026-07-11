// 뉴스 생성 로직 (T-502) — 순수 함수, 배치에서 호출
//
// - 힌트 뉴스(내일자): 이벤트 종목 커버리지 70%, 정식뉴스 90%/찌라시 55% 적중
//   (오보는 반대 방향 같은 세기의 템플릿으로 생성)
// - 페이크 찌라시: 이벤트 없는 종목도 15% 확률로 ±10급 소문 발행
// - 공시(오늘자): 실제 등락 ±5% 이상 또는 상·하한가만 발행 (100% 사실)

import type { Rng } from "@/lib/engine/rng";
import type { NewsGrade } from "@/types/domain";
import {
  DISCLOSURE_TEMPLATES,
  HINT_TEMPLATES,
  type BiasLevel,
  type DisclosureKind,
} from "./templates";

export interface GeneratedNews {
  date: string;
  stockCode: string | null;
  grade: NewsGrade;
  title: string;
  body: string;
}

const COVERAGE = 0.7;
const NEWS_RATIO = 0.6; // 커버된 종목 중 정식뉴스 비율 (나머지는 찌라시)
const NEWS_ACCURACY = 0.9;
const RUMOR_ACCURACY = 0.55;
const FAKE_RUMOR_PROB = 0.15;
const NEUTRAL_NOISE_PROB = 0.1; // 방향성 없는 잡뉴스

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function levelOf(bias: number): BiasLevel {
  return String(bias) as BiasLevel;
}

// 내일자 힌트 뉴스 (편향 추첨 결과 기반 — 실현치가 아니라 "재료" 기준)
export function generateHintNews(
  stockCodes: string[],
  biases: Record<string, number>,
  date: string,
  rng: Rng
): GeneratedNews[] {
  const result: GeneratedNews[] = [];

  for (const code of stockCodes) {
    const templates = HINT_TEMPLATES[code];
    if (!templates) continue;
    const bias = biases[code] ?? 0;

    if (bias !== 0) {
      if (rng() >= COVERAGE) continue; // 뉴스 없는 급등락도 존재해야 한다
      const isNews = rng() < NEWS_RATIO;
      const accurate = rng() < (isNews ? NEWS_ACCURACY : RUMOR_ACCURACY);
      const shownBias = accurate ? bias : -bias;
      const template = pick(rng, templates[levelOf(shownBias)]);
      result.push({
        date,
        stockCode: code,
        grade: isNews ? "news" : "rumor",
        ...template,
      });
    } else if (rng() < FAKE_RUMOR_PROB) {
      // 이벤트 없는 종목의 낚시 찌라시
      const direction = rng() < 0.55 ? 10 : -10;
      const template = pick(rng, templates[levelOf(direction)]);
      result.push({ date, stockCode: code, grade: "rumor", ...template });
    } else if (rng() < NEUTRAL_NOISE_PROB) {
      // 방향성 없는 잡뉴스 (노이즈)
      const template = pick(rng, templates["0"]);
      result.push({ date, stockCode: code, grade: "news", ...template });
    }
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
export function generateDisclosures(
  moves: DailyMove[],
  date: string,
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
    });
  }

  return result;
}

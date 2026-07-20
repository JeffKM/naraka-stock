// 몬테카를로 밸런스 시뮬레이션 (T-207)
//
// 실행: npm run simulate [-- --runs 1000]
// 운영 배치와 동일한 엔진(src/lib/engine/)으로 이벤트 기간의 개장일(휴장 규칙에서 파생 —
// 정기 휴장 없음이면 08-01~08-30 = 30일)을 1,000회 반복해 전략별 최종 자산 분포를 확인한다
// (PRD §10 목표 검증).

import {
  applySectorEvents,
  drawDailyBiases,
  drawSectorEvents,
  realizeBias,
  type BiasMap,
} from "../src/lib/engine/bias";
import { generateDailyPath, type DailyPath, type Tick } from "../src/lib/engine/randomWalk";
import { createRng, hashSeed, type Rng } from "../src/lib/engine/rng";
import { drawSectorRumors, type SectorRumor } from "../src/lib/news/generate";
import { addDays, isOpenDate, ticksPerDay } from "../src/lib/market";
import type { StockSector, StockTier } from "../src/types/domain";

// --- 이벤트 설정 (시드 데이터와 동일) ---
const EVENT_START = "2026-08-01";
const EVENT_END = "2026-08-30";
const INITIAL_CASH = 10_000_000;
const SELL_FEE_RATE = Number(process.env.SIM_SELL_FEE ?? 0.005); // 매도 수수료(튜닝: 잦은 매매 억제)
const DIVIDEND_RATE = 0.01;
// 10초 틱 전환(2026-07-19): 배치 실제 운영과 동일한 하루 틱 수(12~24시 기준 4,320)로
// 경로를 생성해야 σ 정규화(scale = TICKS_PER_DAY/totalTicks)가 실제로 검증된다.
// generateDailyPath의 기본값(TICKS_PER_DAY=84)에 맡기면 엔진 기준 틱수로만 시뮬돼
// 10초 틱 특유의 반올림 드리프트·VI 빈도 변화를 놓친다.
// 튜닝 반복 속도용 오버라이드: --ticks N (기본은 운영과 동일한 ticksPerDay).
// 낮추면 σ 정규화(scale)가 자동 보정돼 절대 배수는 다소 달라지지만 전략 간 "상대 순위"는
// 보존되므로 L1·L2 파라미터 스윕에 충분히 빠르고 유효하다.
const TICKS_ARG_IDX = process.argv.indexOf("--ticks");
const TOTAL_TICKS = TICKS_ARG_IDX >= 0 ? Number(process.argv[TICKS_ARG_IDX + 1]) : ticksPerDay();

// 출석 스트릭 보너스 (2026-07-18 몰입 스펙): 개근 가정 시 dayIdx(0-based)별 지급액.
// 1~2일차 30만 / 3~6일차 50만 / 7일차+ 70만. --attendance 플래그로만 활성(기본 off, 기존 동작 보존).
// 각 전략은 그날 루프 시작에 이 현금을 받아 전략대로 굴린다(존버는 방치=현금 적립, 매일매매는 재투자).
const WITH_ATTENDANCE = process.argv.includes("--attendance");
function attendanceBonus(dayIdx: number): number {
  if (!WITH_ATTENDANCE) return 0;
  const streak = dayIdx + 1; // 개근(무결석) 가정 → dayIdx=스트릭-1
  if (streak <= 2) return 300_000;
  if (streak <= 6) return 500_000;
  return 700_000;
}

// 등급·기준가·섹터는 42종 개편 확정안 기준 (2026-07-17, migrations/20260717020000_roster_42_reprice)
// — 이 배열은 로컬 DB(마이그레이션 적용본)에서 code 오름차순으로 생성해 붙였다(스펙 §7).
// 배열 순서는 code 오름차순(리뷰 결함 수정, 2026-07-17): drawDailyBiases·drawSectorEvents가
// 이 배열 순서로 RNG를 소비하므로, 운영 배치(batchService.ts)의 종목 조회 쿼리가 쓰는
// `.order("code")`와 순서를 맞춰야 두 경로가 동일 시드에서 동일 결과를 낸다. 원래 이
// 배열은 마이그레이션 INSERT 순서(시가총액 순)를 따랐으나, Postgres는 ORDER BY 없는
// SELECT의 행 순서를 보장하지 않으므로 배치 쪽은 code 정렬로 고정했다 — 표시용
// 정렬(quoteService·adminService.listStocks)도 이미 code 기준이라 관례에도 맞다.
const STOCKS: Array<{ code: string; tier: StockTier; sector: StockSector; initial: number }> = [
  { code: "ALBN", tier: "stable", sector: "it", initial: 1800000 },
  { code: "BBNN", tier: "wild", sector: "it", initial: 200000 },
  { code: "BNAS", tier: "wild", sector: "defense", initial: 60000 },
  { code: "BNEN", tier: "normal", sector: "energy", initial: 450000 },
  { code: "BNMR", tier: "stable", sector: "cosmetics", initial: 900000 },
  { code: "BNOC", tier: "normal", sector: "shipaero", initial: 500000 },
  { code: "BNSK", tier: "normal", sector: "finance", initial: 380000 },
  { code: "BNZN", tier: "stable", sector: "retail", initial: 1700000 },
  { code: "MAPL", tier: "stable", sector: "electronics", initial: 1850000 },
  { code: "MELL", tier: "wild", sector: "bio", initial: 75000 },
  { code: "MHBT", tier: "wild", sector: "cosmetics", initial: 100000 },
  { code: "MHEN", tier: "wild", sector: "media", initial: 240000 },
  { code: "MHOL", tier: "stable", sector: "energy", initial: 950000 },
  { code: "MHRN", tier: "normal", sector: "food", initial: 600000 },
  { code: "MHTR", tier: "wild", sector: "telecom", initial: 180000 },
  { code: "MIPA", tier: "normal", sector: "retail", initial: 350000 },
  { code: "MLAB", tier: "normal", sector: "game", initial: 300000 },
  { code: "MLMT", tier: "stable", sector: "retail", initial: 1050000 },
  { code: "MLTA", tier: "wild", sector: "it", initial: 220000 },
  { code: "MLTV", tier: "wild", sector: "robotics", initial: 130000 },
  { code: "MLVD", tier: "stable", sector: "semiconductor", initial: 1950000 },
  { code: "MRCL", tier: "normal", sector: "it", initial: 700000 },
  { code: "MRFI", tier: "normal", sector: "finance", initial: 420000 },
  { code: "MRSF", tier: "normal", sector: "it", initial: 980000 },
  { code: "NOMH", tier: "stable", sector: "it", initial: 1200000 },
  { code: "NRKB", tier: "wild", sector: "bio", initial: 120000 },
  { code: "NRKC", tier: "normal", sector: "materials", initial: 800000 },
  { code: "NRKE", tier: "stable", sector: "electronics", initial: 1750000 },
  { code: "NRKG", tier: "normal", sector: "construction", initial: 400000 },
  { code: "NRKH", tier: "normal", sector: "defense", initial: 780000 },
  { code: "NRKM", tier: "normal", sector: "auto", initial: 850000 },
  { code: "NRKR", tier: "stable", sector: "robotics", initial: 600000 },
  { code: "OKBX", tier: "wild", sector: "game", initial: 85000 },
  { code: "OKCC", tier: "wild", sector: "food", initial: 50000 },
  { code: "OKCT", tier: "normal", sector: "retail", initial: 900000 },
  { code: "OKFX", tier: "normal", sector: "media", initial: 620000 },
  { code: "OKHX", tier: "stable", sector: "semiconductor", initial: 1650000 },
  { code: "OKSC", tier: "stable", sector: "materials", initial: 1100000 },
  { code: "OKSL", tier: "stable", sector: "auto", initial: 1550000 },
  { code: "OKTL", tier: "normal", sector: "telecom", initial: 550000 },
  { code: "RTMC", tier: "stable", sector: "construction", initial: 700000 },
  { code: "SPCO", tier: "wild", sector: "shipaero", initial: 150000 },
];

// 개장일 목록
function openDays(): string[] {
  const days: string[] = [];
  for (let d = EVENT_START; d <= EVENT_END; d = addDays(d, 1)) {
    if (isOpenDate(d)) days.push(d);
  }
  return days;
}

// --- 종목뉴스 채널 (Option 2, 2026-07-20 스펙) ---
// 초반(0~40%)에 종목 단위 방향 신호를 노이즈와 섞어 발행. 방향은 미표기(애매) — 톤이
// 약한 힌트(정확도 TONE_ACC)만 주고, 실력자는 톤 + 초반 시세 브레이크를 종합해 방향·진입 판단.
//   진짜   = |개별 편향|≥CUT 이벤트 (톤이 의도 방향을 TONE_ACC로 가리킴)
//   필러   = 개별 편향 0 종목 (톤은 랜덤 = 방향성0 노이즈), 진짜당 NOISE_RATIO개
// 실현 반전(realizeBias FLIP_PROBABILITY, env SIM_FLIP_PROB)이 "진짜여도 그 방향으로 안 감"
// 노이즈를 담당 → 블라인드 추종을 본전화한다.
const STOCKNEWS_CUT = Number(process.env.SIM_STOCKNEWS_CUT ?? 20); // 조기 전환 대상 |bias| 컷
const STOCKNEWS_TONE_ACC = Number(process.env.SIM_STOCKNEWS_TONE_ACC ?? 0.6); // 톤 정확도(많이 애매=낮게)
const STOCKNEWS_NOISE_RATIO = Number(process.env.SIM_STOCKNEWS_NOISE_RATIO ?? 1.0); // 진짜당 필러 수
// 헤드페이크(펌프-덤프 함정): 초반에 확 튀어 순진한 가격확인을 통과 → 종가엔 꺼진다.
// 진짜당 HEADFAKE_RATIO개. "단서"는 거래량 — 진짜는 거래량 실림(volumeHigh), 헤드페이크·필러는 얇음.
const STOCKNEWS_HEADFAKE_RATIO = Number(process.env.SIM_HEADFAKE_RATIO ?? 0.3); // 운영값 0.3(Phase 3b 확정 스위트스팟)
// 거래량 단서 정확도: 진짜가 거래량 실릴 확률 = 헤드페이크가 얇을 확률. <1이라 단서는 불완전
// (진짜인데 조용한 경우·헤드페이크인데 거래량 실린 더 교묘한 함정 존재) → "거래량만 보면 끝"이
// 안 되게 만든다. 실력 = 거래량+가격+톤 종합 판단.
const STOCKNEWS_VOL_TELL_ACC = Number(process.env.SIM_VOL_TELL_ACC ?? 0.8);

type NewsKind = "real" | "filler" | "headfake";

interface StockNews {
  code: string;
  toneUp: boolean; // 톤이 은근히 가리키는 방향 (up=호재 느낌). 정확도 TONE_ACC로만 진짜 방향 일치
  kind: NewsKind; // real=진짜 이벤트 / filler=방향성0 / headfake=펌프덤프 함정
  volumeHigh: boolean; // 거래량 단서: real=true(실림), filler·headfake=false(얇음)
}

// 헤드페이크 경로: 개장가에서 corrob 지점(≈30%)까지 펌프(+6~14%) → 종가엔 덤프(−6~0%).
// 순진한 가격확인은 corrob 시점의 펌프를 보고 사서 덤프에 물린다. newsRng로 생성(시장 RNG 불변).
function headFakePath(prevClose: number, newsRng: Rng, totalTicks: number): DailyPath {
  const open = prevClose;
  const pump = 0.06 + newsRng() * 0.08; // 펌프 정점 상승률
  const closeRet = -0.06 + newsRng() * 0.06; // 종가 순수익 (−6%~0%)
  const peakAt = Math.floor(totalTicks * CORROB_FRACTION); // 정점 = 확인 시점에 딱 맞춤(함정)
  const ticks: Tick[] = [];
  let high = open;
  let low = open;
  let price = open;
  for (let i = 0; i < totalTicks; i++) {
    // 정점까지 상승 → 이후 종가까지 하강 (구간 선형 + 소음)
    const frac =
      i <= peakAt
        ? (i / Math.max(1, peakAt)) * pump
        : pump + ((i - peakAt) / Math.max(1, totalTicks - 1 - peakAt)) * (closeRet - pump);
    const noise = (newsRng() - 0.5) * 0.01;
    price = Math.max(1, Math.round(open * (1 + frac + noise)));
    high = Math.max(high, price);
    low = Math.min(low, price);
    ticks.push({ tickIndex: i, price, isHalted: false, volume: 1 });
  }
  return { ticks, open, high, low, close: ticks[ticks.length - 1].price };
}

interface DayMarket {
  date: string;
  isFriday: boolean;
  biases: BiasMap;
  paths: Record<string, DailyPath>;
  prevCloses: Record<string, number>;
  rumors: SectorRumor[]; // 그날 장 초반 섹터 찌라시 (예고 섹터·방향)
  sectorActualUp: Record<string, boolean>; // 섹터별 실제 평균 방향(종가 기준) — 소문 적중 판정용
  stockNews: StockNews[]; // 그날 초반 종목뉴스 (진짜+필러)
  stockActualUp: Record<string, boolean>; // 종목별 실제 방향(종가>전일종가) — 뉴스 적중 판정용
}

// 종목뉴스 생성 — 시장 RNG와 분리된 newsRng로 생성해 시장 경로에 영향 없음(스윕 간 동일 시장 보장).
// individualBiases = 섹터 가산 전 개별 편향(뉴스 대상 판정용).
function drawStockNews(
  individualBiases: BiasMap,
  newsRng: Rng
): StockNews[] {
  const news: StockNews[] = [];
  const pool: string[] = []; // 개별편향0 종목 = 필러·헤드페이크 후보
  let realCount = 0;
  for (const s of STOCKS) {
    const b = individualBiases[s.code] ?? 0;
    if (Math.abs(b) >= STOCKNEWS_CUT) {
      // 진짜: 톤은 의도 방향(부호)을 TONE_ACC 확률로 맞힘. 거래량 실림.
      const trueUp = b > 0;
      const toneUp = newsRng() < STOCKNEWS_TONE_ACC ? trueUp : !trueUp;
      // 진짜는 대개 거래량 실림(VOL_TELL_ACC), 가끔 조용함 → 단서 불완전
      news.push({ code: s.code, toneUp, kind: "real", volumeHigh: newsRng() < STOCKNEWS_VOL_TELL_ACC });
      realCount++;
    } else if (b === 0) {
      pool.push(s.code);
    }
  }
  const draw = () => (pool.length ? pool.splice(Math.floor(newsRng() * pool.length), 1)[0] : null);
  // 헤드페이크: 진짜 수 × HEADFAKE_RATIO개. 호재처럼 보이게(toneUp) 튀지만 거래량 얇음.
  const headfakeCount = Math.min(pool.length, Math.round(realCount * STOCKNEWS_HEADFAKE_RATIO));
  for (let i = 0; i < headfakeCount; i++) {
    const code = draw();
    // 헤드페이크는 대개 거래량 얇음, 가끔 실림(20%) = 거래량 확인도 속이는 더 교묘한 함정
    if (code) news.push({ code, toneUp: true, kind: "headfake", volumeHigh: newsRng() >= STOCKNEWS_VOL_TELL_ACC });
  }
  // 필러: 진짜 수 × NOISE_RATIO개. 톤 랜덤, 거래량 얇음.
  const fillerCount = Math.min(pool.length, Math.round(realCount * STOCKNEWS_NOISE_RATIO));
  for (let i = 0; i < fillerCount; i++) {
    const code = draw();
    if (code) news.push({ code, toneUp: newsRng() < 0.5, kind: "filler", volumeHigh: false });
  }
  return news;
}

// 한 회차의 시장 전체 시뮬레이션 (배치와 동일한 절차)
function simulateMarket(rng: Rng, newsRng: Rng): DayMarket[] {
  const closes: Record<string, number> = Object.fromEntries(
    STOCKS.map((s) => [s.code, s.initial])
  );
  const result: DayMarket[] = [];

  for (const date of openDays()) {
    let biases = drawDailyBiases(STOCKS, rng);
    const individualBiases = { ...biases }; // 섹터 가산 전 개별 편향 (종목뉴스 대상 판정용)
    // 섹터 이벤트 (참여확률 모델, Plan 3): 배치와 동일하게 drawDailyBiases 직후·경로
    // 생성 전에 뽑고 가산한다. applySectorEvents는 참여 판정으로 RNG를 소비하므로
    // 이 순서·소비량이 batchService와 정확히 일치해야 동일 시드에서 동일 결과가 난다.
    const sectorEvents = drawSectorEvents(STOCKS, rng);
    biases = applySectorEvents(biases, STOCKS, sectorEvents, rng);
    const paths: Record<string, DailyPath> = {};
    const prevCloses = { ...closes };
    for (const stock of STOCKS) {
      // 배치와 동일: 뉴스용 bias와 별개로 실현치는 확률적
      const path = generateDailyPath(
        closes[stock.code],
        realizeBias(biases[stock.code], rng),
        stock.tier,
        rng,
        TOTAL_TICKS
      );
      paths[stock.code] = path;
      closes[stock.code] = path.close;
    }
    // 섹터 찌라시 (v2): 경로 생성이 끝난 뒤 추첨한다(배치도 경로·정식뉴스 뒤에 소문 생성).
    // 진짜 소문은 sectorEvents 방향을 그대로, 가짜는 이벤트 없는 섹터에서 랜덤 추첨.
    // 주의: 위 sectorEvents/bias/path 구간과 달리 이 소문 추첨은 batchService와의 "동일 시드
    // 동일 결과" 대상이 아니다(시드 스킴 자체가 다르고, 배치는 하루 단위·시뮬은 연속 스트림).
    // 가격 경로가 소문 추첨 전에 이미 확정되므로 시세엔 무관하고, 균등 RNG 소비라 적중률의
    // 통계적 대표성만 유지하면 충분하다.
    const allSectors = Array.from(new Set(STOCKS.map((s) => s.sector)));
    const rumors = drawSectorRumors(sectorEvents, allSectors, rng);
    // 섹터별 실제 방향: 구성원 (종가-전일종가)/전일종가 평균의 부호 (소문 적중 판정 기준)
    const sectorActualUp: Record<string, boolean> = {};
    for (const sec of allSectors) {
      const members = STOCKS.filter((s) => s.sector === sec);
      const avg =
        members.reduce(
          (sum, m) => sum + (closes[m.code] - prevCloses[m.code]) / prevCloses[m.code],
          0
        ) / members.length;
      sectorActualUp[sec] = avg >= 0;
    }
    // 종목뉴스 (Option 2): 분리된 newsRng로 생성 → 시장 경로 불변. 종목별 실제 방향도 집계.
    const stockNews = drawStockNews(individualBiases, newsRng);
    // 헤드페이크 종목은 경로를 펌프-덤프로 덮어쓴다(개별편향0 종목이라 시장 통계엔 영향 미미).
    for (const nw of stockNews) {
      if (nw.kind === "headfake") {
        paths[nw.code] = headFakePath(prevCloses[nw.code], newsRng, TOTAL_TICKS);
        closes[nw.code] = paths[nw.code].close;
      }
    }
    const stockActualUp: Record<string, boolean> = {};
    for (const s of STOCKS) {
      stockActualUp[s.code] = closes[s.code] >= prevCloses[s.code];
    }
    result.push({
      date,
      isFriday: new Date(`${date}T12:00:00Z`).getUTCDay() === 5,
      biases,
      paths,
      prevCloses,
      rumors,
      sectorActualUp,
      stockNews,
      stockActualUp,
    });
  }
  return result;
}

// --- 뉴스 배치 타이밍 실험 (T-503) ---
// 정식뉴스가 하루 경로의 어느 틱에 노출되느냐 = 뉴스추종이 먹을 수 있는 "남은 드리프트".
//   steepest = 현재 운영: 가장 가파른 3틱 구간 (움직임 한창)
//   middle   = 장 중간
//   tail     = 움직임이 대부분 끝난 뒤 (후반 85% 지점)
//   close    = 종가 직전 (남은 움직임 ≈ 0)
type NewsTiming = "steepest" | "middle" | "tail" | "close";
const NEWS_TIMING: NewsTiming = ((): NewsTiming => {
  const i = process.argv.indexOf("--news-timing");
  const v = i >= 0 ? process.argv[i + 1] : "tail"; // 운영 기본값 = tail (generate.ts와 동일)
  return (["steepest", "middle", "tail", "close"] as const).includes(v as NewsTiming)
    ? (v as NewsTiming)
    : "tail";
})();

const STEEP_WINDOW = 3; // generate.ts와 동일

// generate.ts의 steepestTickIndex와 동일 로직
function steepestTickIndex(ticks: { tickIndex: number; price: number }[]): number {
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

function newsTickIndex(ticks: { tickIndex: number; price: number }[], mode: NewsTiming): number {
  const last = ticks.length - 1;
  switch (mode) {
    case "steepest":
      return steepestTickIndex(ticks);
    case "middle":
      return Math.floor(last * 0.5);
    case "tail":
      // generate.ts tailNewsTick과 동일: steepest 이후 & 후반 85% 이후 중 늦은 쪽
      return Math.max(steepestTickIndex(ticks), Math.floor(last * 0.85));
    case "close":
      return last;
  }
}

// --- 전략들: 하루 단위로 (현금, 보유) 상태를 갱신한다 ---

type Portfolio = { cash: number; qty: Record<string, number> };

function buyAll(p: Portfolio, code: string, price: number) {
  const qty = Math.floor(p.cash / price);
  if (qty > 0) {
    p.cash -= qty * price;
    p.qty[code] = (p.qty[code] ?? 0) + qty;
  }
}

function sellAll(p: Portfolio, code: string, price: number) {
  const qty = p.qty[code] ?? 0;
  if (qty > 0) {
    const gross = qty * price;
    p.cash += gross - Math.floor(gross * SELL_FEE_RATE);
    p.qty[code] = 0;
  }
}

function totalAssets(p: Portfolio, closes: Record<string, number>): number {
  let total = p.cash;
  for (const [code, qty] of Object.entries(p.qty)) {
    total += qty * (closes[code] ?? 0);
  }
  return total;
}

function payDividends(p: Portfolio, day: DayMarket) {
  if (!day.isFriday) return;
  for (const stock of STOCKS) {
    if (stock.tier !== "stable") continue;
    const qty = p.qty[stock.code] ?? 0;
    if (qty > 0) {
      p.cash += Math.floor(qty * day.paths[stock.code].close * DIVIDEND_RATE);
    }
  }
}

interface Strategy {
  name: string;
  run: (market: DayMarket[], rng: Rng) => number; // 최종 총자산
}

// 지정가 브라켓(데이 트레이드): 매일 대상 종목에 시가 -dip% 지정가 매수를 걸고,
// 체결되면 매수가 +rise% 지정가 매도를 건다. 미체결 매도는 종가에 청산(당일 만료).
// 실제 규칙 재현: 매수 틱≤지정가 / 매도 틱≥지정가, 체결가=지정가 고정, halt 틱 스킵,
// 밴드밖(±30%) 지정가 접수 거부. OU 되돌림을 수확하려는 스마트 전략의 지배력 검증용.
function bracketStrategy(
  name: string,
  tier: StockTier | "all",
  dip: number,
  rise: number
): Strategy {
  return {
    name,
    run: (market) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      const targets = tier === "all" ? STOCKS : STOCKS.filter((s) => s.tier === tier);
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        const budget = Math.floor(p.cash / targets.length); // 종목별 균등 예약
        let spent = 0;
        let proceeds = 0;
        for (const stock of targets) {
          const path = day.paths[stock.code];
          const buyLimit = Math.round(path.open * (1 - dip));
          // 밴드밖(±30%) 지정가는 접수 거부
          const lowerBand = Math.round(day.prevCloses[stock.code] * (1 - 0.3));
          if (buyLimit < lowerBand) continue;
          // 매수 체결 틱: 가격 ≤ 지정가 (halt 스킵)
          let buyIdx = -1;
          for (let i = 0; i < path.ticks.length; i++) {
            if (path.ticks[i].isHalted) continue;
            if (path.ticks[i].price <= buyLimit) {
              buyIdx = i;
              break;
            }
          }
          if (buyIdx < 0) continue; // 매수 미체결 → 현금 유지
          const qty = Math.floor(budget / buyLimit);
          if (qty <= 0) continue;
          spent += qty * buyLimit;
          // 매도 체결 틱: 매수 이후 가격 ≥ 지정가, 없으면 종가 청산
          const sellLimit = Math.round(buyLimit * (1 + rise));
          let exitPrice = path.close;
          for (let j = buyIdx + 1; j < path.ticks.length; j++) {
            if (path.ticks[j].isHalted) continue;
            if (path.ticks[j].price >= sellLimit) {
              exitPrice = sellLimit;
              break;
            }
          }
          const gross = qty * exitPrice;
          proceeds += gross - Math.floor(gross * SELL_FEE_RATE);
        }
        p.cash += proceeds - spent;
      }
      return p.cash;
    },
  };
}

// --- 소문 교차검증(실력자) 전략 파라미터 ---
// 소문은 장 초반 창(generate.ts RUMOR_WINDOW_RATIO=0.2)에 노출된다. 실력자는 그 직후
// (기본 30% 지점)까지 해당 섹터가 소문 방향으로 "실제로 움직이기 시작했는지"를 관측해
// 진짜/가짜를 거른 뒤, 가장 강하게 확인된 up 섹터 하나에 확신 집중(전액)한다.
// 확인 안 되면 현금 보유(스킵). 초반 시세로 가짜를 걸러내는 판단이 곧 실력이다.
const CORROB_FRACTION = 0.3; // 관측·진입 시점 (하루 틱의 비율, 소문 창 0.2 직후)
const CORROB_THRESHOLD_BASE = 0.005; // 진짜로 판정할 최소 초반 상승률 (0.5%)

interface SkilledEntry {
  sector: string;
  members: string[];
  entryIdx: number;
  earlyReturn: number;
}

// 하루치 소문 교차검증 판정. threshold를 플레이어별로 흔들어(rng) 이질성을 준다.
function skilledEntry(day: DayMarket, threshold: number): SkilledEntry | null {
  const upSectors = Array.from(
    new Set(day.rumors.filter((r) => r.direction === "up").map((r) => r.sector))
  );
  if (upSectors.length === 0) return null;
  let best: SkilledEntry | null = null;
  for (const sector of upSectors) {
    const members = STOCKS.filter((s) => s.sector === sector).map((s) => s.code);
    if (members.length === 0) continue;
    const refTicks = day.paths[members[0]].ticks;
    const entryIdx = Math.min(
      refTicks.length - 1,
      Math.floor(refTicks.length * CORROB_FRACTION)
    );
    // 초반 상승률 = 구성원 (관측가 - 개장가)/개장가 평균
    let sum = 0;
    for (const code of members) {
      const path = day.paths[code];
      sum += (path.ticks[entryIdx].price - path.open) / path.open;
    }
    const earlyReturn = sum / members.length;
    if (earlyReturn >= threshold && (!best || earlyReturn > best.earlyReturn)) {
      best = { sector, members, entryIdx, earlyReturn };
    }
  }
  return best;
}

// 종목뉴스 교차검증 진입: 초반 시세 브레이크 + 톤을 종합. tone-up은 약한 확인(upThresh)으로,
// tone-down은 강한 상승 확인(OVERRIDE)이 있어야 매수(가격이 톤을 뒤집음). 확인 상위 2종목 집중.
const STOCKNEWS_CORROB_UP = 0.003; // tone-up 기본 확인 임계 (초반 상승률)
const STOCKNEWS_CORROB_OVERRIDE = 0.012; // tone-down이어도 이만큼 오르면 매수

// requireVolume=true면 "거래량 실린" 뉴스만 확인 대상(=헤드페이크 함정 회피). false면 순진(가격만).
function stockNewsEntries(
  day: DayMarket,
  upThresh: number,
  requireVolume: boolean
): { codes: string[]; idx: number } {
  const refTicks = day.paths[STOCKS[0].code].ticks;
  const idx = Math.min(refTicks.length - 1, Math.floor(refTicks.length * CORROB_FRACTION));
  const scored: Array<{ code: string; er: number }> = [];
  for (const nw of day.stockNews) {
    if (requireVolume && !nw.volumeHigh) continue; // 거래량 단서: 얇으면 함정으로 보고 스킵
    const path = day.paths[nw.code];
    const er = (path.ticks[idx].price - path.open) / path.open;
    const thresh = nw.toneUp ? upThresh : STOCKNEWS_CORROB_OVERRIDE;
    if (er >= thresh) scored.push({ code: nw.code, er });
  }
  scored.sort((a, b) => b.er - a.er);
  return { codes: scored.slice(0, 2).map((s) => s.code), idx };
}

const STRATEGIES: Strategy[] = [
  {
    // 존버: 첫날 전 종목 균등 분산 매수 후 방치 (배당 수령)
    name: "존버(분산)",
    run: (market) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      const first = market[0];
      const budget = Math.floor(p.cash / STOCKS.length);
      for (const stock of STOCKS) {
        const price = first.paths[stock.code].open;
        const qty = Math.floor(budget / price);
        p.cash -= qty * price;
        p.qty[stock.code] = qty;
      }
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        payDividends(p, day);
      }
      const lastCloses = Object.fromEntries(
        STOCKS.map((s) => [s.code, market[market.length - 1].paths[s.code].close])
      );
      return totalAssets(p, lastCloses);
    },
  },
  {
    // 안정주 존버: 안정주 전체 균등 매수 (배당 파밍)
    name: "존버(안정주)",
    run: (market) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      const first = market[0];
      const stables = STOCKS.filter((s) => s.tier === "stable");
      const budget = Math.floor(p.cash / stables.length);
      for (const stock of stables) {
        const price = first.paths[stock.code].open;
        const qty = Math.floor(budget / price);
        p.cash -= qty * price;
        p.qty[stock.code] = qty;
      }
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        payDividends(p, day);
      }
      const lastCloses = Object.fromEntries(
        STOCKS.map((s) => [s.code, market[market.length - 1].paths[s.code].close])
      );
      return totalAssets(p, lastCloses);
    },
  },
  {
    // 단타(무작위): 매일 아무 종목이나 시가 몰빵 → 종가 전량 매도
    name: "단타(무작위)",
    run: (market, rng) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        const stock = STOCKS[Math.floor(rng() * STOCKS.length)];
        buyAll(p, stock.code, day.paths[stock.code].open);
        sellAll(p, stock.code, day.paths[stock.code].close);
        payDividends(p, day);
      }
      return p.cash;
    },
  },
  {
    // 뉴스추종: 커버리지 70%·적중률 90%의 힌트를 받아 가장 강한 상승 힌트에 몰빵.
    // 현실화(2026-07-14): 시가가 아니라 "뉴스가 뜬 틱 가격"에 사서 종가에 판다.
    // 뉴스 배치 위치(NEWS_TIMING)에 따라 남은 드리프트만 먹을 수 있으므로,
    // 뉴스를 뒤로 밀수록 이득이 줄어든다.
    name: "뉴스추종",
    run: (market, rng) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        let best: { code: string; hint: number } | null = null;
        for (const stock of STOCKS) {
          const bias = day.biases[stock.code];
          if (bias === 0 || rng() >= 0.7) continue; // 뉴스 없음
          const hint = rng() < 0.9 ? bias : -bias; // 10% 오보
          if (hint > 0 && (!best || hint > best.hint)) {
            best = { code: stock.code, hint };
          }
        }
        if (best) {
          const ticks = day.paths[best.code].ticks;
          const entryIdx = newsTickIndex(ticks, NEWS_TIMING);
          buyAll(p, best.code, ticks[entryIdx].price); // 뉴스 뜬 틱에 진입
          sellAll(p, best.code, day.paths[best.code].close);
        }
        payDividends(p, day);
      }
      return p.cash;
    },
  },
  {
    // 잡주 몰빵: 매일 잡주 중 하나에 시가 몰빵 → 종가 매도 (하이리스크 상한 확인용)
    name: "잡주몰빵",
    run: (market, rng) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      const wilds = STOCKS.filter((s) => s.tier === "wild");
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        const stock = wilds[Math.floor(rng() * wilds.length)];
        buyAll(p, stock.code, day.paths[stock.code].open);
        sellAll(p, stock.code, day.paths[stock.code].close);
        payDividends(p, day);
      }
      return p.cash;
    },
  },
  bracketStrategy("지정가브라켓(잡주4/4)", "wild", 0.04, 0.04),
  bracketStrategy("지정가브라켓(잡주6/6)", "wild", 0.06, 0.06),
  bracketStrategy("지정가브라켓(잡주8/8)", "wild", 0.08, 0.08),
  bracketStrategy("지정가브라켓(전종목6)", "all", 0.06, 0.06),
  {
    // 섹터소문추종: 장 초반 'up' 찌라시가 뜬 섹터의 구성원 전부를 개장가에 균등 매수 →
    // 종가 청산. 소문이 예측력을 가지면(적중>50%) 이 전략이 이득을 봐야 하고, 그 이득이
    // 존버·본전을 지배하면 밸런스 붕괴 신호다. 노출 창을 뒤로 미루거나 가짜를 늘려 억제한다.
    name: "섹터소문추종",
    run: (market) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        const upSectors = new Set(
          day.rumors.filter((r) => r.direction === "up").map((r) => r.sector)
        );
        const targets = STOCKS.filter((s) => upSectors.has(s.sector));
        if (targets.length > 0) {
          const budget = Math.floor(p.cash / targets.length); // 종목별 균등 예약
          for (const stock of targets) {
            const price = day.paths[stock.code].open;
            const qty = Math.floor(budget / price);
            if (qty > 0) {
              p.cash -= qty * price;
              p.qty[stock.code] = (p.qty[stock.code] ?? 0) + qty;
            }
          }
        }
        for (const stock of STOCKS) sellAll(p, stock.code, day.paths[stock.code].close);
        payDividends(p, day);
      }
      return p.cash;
    },
  },
  {
    // 소문교차검증(실력자): 장 초반 소문 뜬 섹터가 실제로 그 방향으로 움직이기 시작했는지
    // 확인(초반 상승률 ≥ 임계)한 뒤, 가장 강하게 확인된 up 섹터 하나에 확신 집중(전액)
    // → 종가 청산. 확인 안 되면 현금 보유. 가짜 소문은 초반에 안 움직여 자동 필터된다.
    // 이 전략이 잡주몰빵·블라인드 소문추종을 순위에서 지배해야 "실력자가 이긴다".
    name: "소문교차검증",
    run: (market, rng) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      // 플레이어별 확인 기준 편차: base + 0~0.4%p (신중/공격 성향 차이)
      const threshold = CORROB_THRESHOLD_BASE + rng() * 0.004;
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        const entry = skilledEntry(day, threshold);
        if (entry) {
          const budget = Math.floor(p.cash / entry.members.length); // 확인 섹터 균등 집중
          for (const code of entry.members) {
            const price = day.paths[code].ticks[entry.entryIdx].price;
            const qty = Math.floor(budget / price);
            if (qty > 0) {
              p.cash -= qty * price;
              p.qty[code] = (p.qty[code] ?? 0) + qty;
            }
          }
        }
        for (const stock of STOCKS) sellAll(p, stock.code, day.paths[stock.code].close);
        payDividends(p, day);
      }
      return p.cash;
    },
  },
  {
    // 종목뉴스 블라인드톤추종: 초반 톤-up 뉴스 종목을 개장가에 균등 매수 → 종가 청산.
    // 톤만 믿고 시세 확인 안 함. 진짜:필러·톤정확도·반전 노이즈로 "본전 이하"가 목표.
    name: "종목뉴스블라인드",
    run: (market) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        const targets = day.stockNews.filter((n) => n.toneUp).map((n) => n.code);
        if (targets.length > 0) {
          const budget = Math.floor(p.cash / targets.length);
          for (const code of targets) {
            const price = day.paths[code].open;
            const qty = Math.floor(budget / price);
            if (qty > 0) {
              p.cash -= qty * price;
              p.qty[code] = (p.qty[code] ?? 0) + qty;
            }
          }
        }
        for (const stock of STOCKS) sellAll(p, stock.code, day.paths[stock.code].close);
        payDividends(p, day);
      }
      return p.cash;
    },
  },
  stockNewsCrossVerify("종목뉴스가격확인", false), // 순진: 가격 브레이크만 → 헤드페이크에 물림
  stockNewsCrossVerify("종목뉴스거래량확인", true), // 실력: 가격+거래량 단서 → 헤드페이크 회피
  {
    // 다채널종합(실력자): 섹터 소문이 확인된 섹터를 사되, 그 멤버 중 종목뉴스가 악재톤(tone-down)인
    // 종목은 제외한다. 두 채널(섹터↑ vs 개별 악재)의 충돌을 해소하는 게 추가 스킬인지 측정.
    name: "다채널종합",
    run: (market, rng) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      const threshold = CORROB_THRESHOLD_BASE + rng() * 0.004;
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        const entry = skilledEntry(day, threshold);
        if (entry) {
          const badTone = new Set(
            day.stockNews.filter((n) => !n.toneUp).map((n) => n.code)
          );
          const members = entry.members.filter((c) => !badTone.has(c)); // 악재톤 멤버 제외
          if (members.length > 0) {
            const budget = Math.floor(p.cash / members.length);
            for (const code of members) {
              const price = day.paths[code].ticks[entry.entryIdx].price;
              const qty = Math.floor(budget / price);
              if (qty > 0) {
                p.cash -= qty * price;
                p.qty[code] = (p.qty[code] ?? 0) + qty;
              }
            }
          }
        }
        for (const stock of STOCKS) sellAll(p, stock.code, day.paths[stock.code].close);
        payDividends(p, day);
      }
      return p.cash;
    },
  },
];

// 종목뉴스 교차검증 전략 팩토리 — requireVolume로 순진(가격만)/실력(가격+거래량)을 만든다.
function stockNewsCrossVerify(name: string, requireVolume: boolean): Strategy {
  return {
    name,
    run: (market, rng) => {
      const p: Portfolio = { cash: INITIAL_CASH, qty: {} };
      const upThresh = STOCKNEWS_CORROB_UP * (0.5 + rng()); // 플레이어별 확인 기준 편차
      let dayIdx = 0;
      for (const day of market) {
        p.cash += attendanceBonus(dayIdx++);
        const { codes, idx } = stockNewsEntries(day, upThresh, requireVolume);
        if (codes.length > 0) {
          const budget = Math.floor(p.cash / codes.length);
          for (const code of codes) {
            const price = day.paths[code].ticks[idx].price;
            const qty = Math.floor(budget / price);
            if (qty > 0) {
              p.cash -= qty * price;
              p.qty[code] = (p.qty[code] ?? 0) + qty;
            }
          }
        }
        for (const stock of STOCKS) sellAll(p, stock.code, day.paths[stock.code].close);
        payDividends(p, day);
      }
      return p.cash;
    },
  };
}

// --- 실행 ---

function percentile(sorted: number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

// --- 토너먼트(크라운) 모드 ---
// 여러 명이 "같은 장"(실제 이벤트처럼 시세 공유)에서 경쟁 → 최종 총자산 순위를 매기고
// 상위 4위(=상품)를 archetype별로 누가 차지하는지 집계한다. 각 archetype을 copies명씩
// 넣고, 확률적 전략은 플레이어마다 독립 RNG로 다른 결과를 낸다(결정론적 전략은 동률).
// 목표: 소문교차검증(실력)이 잡주몰빵(운·분산)보다 1위·상위4를 더 많이 차지하는가?
// 마켓은 메인 루프에서 이미 생성한 것을 재사용한다(중복 생성 제거 — 속도 2배).
function makeField(copies: number) {
  const byName = Object.fromEntries(STRATEGIES.map((s) => [s.name, s]));
  const fieldNames = [
    "종목뉴스거래량확인",
    "종목뉴스가격확인",
    "다채널종합",
    "소문교차검증",
    "잡주몰빵",
    "단타(무작위)",
  ];
  return fieldNames.map((name) => ({ name, strategy: byName[name], copies }));
}

type Field = ReturnType<typeof makeField>;

// 한 장(market)에 대해 필드 전원을 세워 순위를 매기고 1위·상위4 집계에 반영.
function tallyField(
  field: Field,
  market: DayMarket[],
  run: number,
  rank1: Record<string, number>,
  top4: Record<string, number>
) {
  const players: Array<{ arch: string; assets: number }> = [];
  for (const a of field) {
    for (let c = 0; c < a.copies; c++) {
      const rng = createRng(hashSeed(`field|${a.name}|${c}|${run}`));
      players.push({ arch: a.name, assets: a.strategy.run(market, rng) });
    }
  }
  players.sort((x, y) => y.assets - x.assets);
  rank1[players[0].arch]++;
  for (let i = 0; i < 4 && i < players.length; i++) top4[players[i].arch]++;
}

function printField(
  field: Field,
  rank1: Record<string, number>,
  top4: Record<string, number>,
  runs: number,
  copies: number
) {
  const totalPlayers = field.reduce((s, a) => s + a.copies, 0);
  const baseline = ((copies / totalPlayers) * 100).toFixed(1);
  console.log(
    `\n토너먼트(크라운) — 필드 ${totalPlayers}명 (archetype ${field.length}종 × ${copies}명) × ${runs}장`
  );
  console.log("archetype           P(1위)   상위4 점유(4칸 중 평균 / 비율)");
  for (const a of field) {
    const p1 = ((rank1[a.name] / runs) * 100).toFixed(1);
    const t4avg = (top4[a.name] / runs).toFixed(2);
    const t4share = ((top4[a.name] / (runs * 4)) * 100).toFixed(1);
    console.log(`${a.name.padEnd(18)} ${p1.padStart(5)}%   ${t4avg} / 4  (${t4share}%)`);
  }
  console.log(
    `  기준선(무편향): 각 archetype = 인원비율 ${baseline}%. 이보다 높으면 우위, 낮으면 열위.`
  );
}

function main() {
  const runsArg = process.argv.indexOf("--runs");
  const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 1000;
  const copiesArg = process.argv.indexOf("--copies");
  const copies = copiesArg >= 0 ? Number(process.argv[copiesArg + 1]) : 12;

  console.log(
    `개장일 ${openDays().length}일 × ${runs}회 몬테카를로 시뮬레이션 ` +
      `(틱수=${TOTAL_TICKS}, 뉴스=${NEWS_TIMING}, ` +
      `잡주up=${process.env.SIM_WILD_UP_PROB ?? "0.5"}, ` +
      `잡주drift=${process.env.SIM_WILD_DRIFT ?? "-1.0"}, ` +
      `잡주점프up=${process.env.SIM_WILD_JUMP_UP_PROB ?? "0.35"}, ` +
      `섹터강도=${process.env.SIM_SECTOR_MAG ?? "25"}, ` +
      `매도수수료=${(SELL_FEE_RATE * 100).toFixed(1)}%, ` +
      `톤정확도=${process.env.SIM_STOCKNEWS_TONE_ACC ?? "0.6"}, ` +
      `노이즈비=${process.env.SIM_STOCKNEWS_NOISE_RATIO ?? "1.0"}, ` +
      `헤드페이크비=${process.env.SIM_HEADFAKE_RATIO ?? "0.3"}, ` +
      `반전=${process.env.SIM_FLIP_PROB ?? "0.3"})\n`
  );

  const results: Record<string, number[]> = Object.fromEntries(
    STRATEGIES.map((s) => [s.name, []])
  );

  // 섹터 소문 적중 집계 (예고 방향 == 그 섹터 실제 평균 방향). 진짜/가짜 분리 측정.
  const rumorStat = {
    all: { hit: 0, total: 0 },
    real: { hit: 0, total: 0 },
    fake: { hit: 0, total: 0 },
  };
  // 소문교차검증 진입 진단: 확인 통과해 진입한 날의 방향 적중·진짜소문 비율
  const skilledStat = { entries: 0, correct: 0, onReal: 0, skipped: 0, days: 0 };
  // 종목뉴스 진단: 톤 적중 + 순진(가격만) vs 실력(가격+거래량) 진입 정확도·헤드페이크 함정률
  const stockNewsStat = {
    toneN: 0,
    toneHit: 0,
    naive: { entries: 0, hit: 0, trap: 0 }, // trap = 헤드페이크에 진입한 횟수
    vol: { entries: 0, hit: 0, trap: 0 },
  };

  // 토너먼트(크라운) 집계 — 같은 마켓을 재사용해 메인 루프에서 함께 계산
  const field = makeField(copies);
  const rank1: Record<string, number> = {};
  const top4: Record<string, number> = {};
  for (const a of field) {
    rank1[a.name] = 0;
    top4[a.name] = 0;
  }

  for (let run = 0; run < runs; run++) {
    const marketRng = createRng(hashSeed(`market|${run}`));
    const newsRng = createRng(hashSeed(`stocknews|${run}`)); // 시장과 분리 → 스윕 간 동일 시장
    const market = simulateMarket(marketRng, newsRng);
    tallyField(field, market, run, rank1, top4);
    for (const day of market) {
      for (const r of day.rumors) {
        const correct = (r.direction === "up") === day.sectorActualUp[r.sector];
        rumorStat.all.total++;
        if (correct) rumorStat.all.hit++;
        const kind = r.isFake ? rumorStat.fake : rumorStat.real;
        kind.total++;
        if (correct) kind.hit++;
      }
      // 소문교차검증이 이 날 진입했다면(base 임계) 방향·진짜소문 여부 집계
      const entry = skilledEntry(day, CORROB_THRESHOLD_BASE);
      if (entry) {
        skilledStat.entries++;
        if (day.sectorActualUp[entry.sector]) skilledStat.correct++;
        if (
          day.rumors.some(
            (r) => r.sector === entry.sector && !r.isFake && r.direction === "up"
          )
        )
          skilledStat.onReal++;
      } else {
        skilledStat.skipped++;
      }
      skilledStat.days++;
      // 종목뉴스: 톤 적중 + 순진/실력 진입 정확도·헤드페이크 함정률
      for (const nw of day.stockNews) {
        stockNewsStat.toneN++;
        if (nw.toneUp === day.stockActualUp[nw.code]) stockNewsStat.toneHit++;
      }
      const newsByCode = new Map(day.stockNews.map((n) => [n.code, n]));
      const tally = (s: { entries: number; hit: number; trap: number }, req: boolean) => {
        for (const code of stockNewsEntries(day, STOCKNEWS_CORROB_UP, req).codes) {
          s.entries++;
          if (day.stockActualUp[code]) s.hit++;
          if (newsByCode.get(code)?.kind === "headfake") s.trap++;
        }
      };
      tally(stockNewsStat.naive, false); // 가격만
      tally(stockNewsStat.vol, true); // 가격+거래량
    }
    for (const strategy of STRATEGIES) {
      const rng = createRng(hashSeed(`${strategy.name}|${run}`));
      results[strategy.name].push(strategy.run(market, rng));
    }
  }

  const fmt = (n: number) => `${(n / INITIAL_CASH).toFixed(2)}×`; // 초기자금(10M) 대비 실제 배수
  console.log(
    "전략별 최종 총자산 (초기 자금 대비 배수) — 중앙값 / 평균 / 상위10% / 최대 / 원금손실율"
  );
  for (const strategy of STRATEGIES) {
    const sorted = [...results[strategy.name]].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const lossRate = sorted.filter((v) => v < INITIAL_CASH).length / sorted.length;
    console.log(
      `${strategy.name.padEnd(18)} ${fmt(percentile(sorted, 0.5))} / ${fmt(mean)} / ${fmt(
        percentile(sorted, 0.9)
      )} / ${fmt(sorted[sorted.length - 1])} / ${(lossRate * 100).toFixed(1)}%`
    );
  }

  // 섹터 소문 적중률 (목표: 전체 55~70%) + 하루 평균 소문 수
  const pct = (h: number, t: number) => (t > 0 ? ((h / t) * 100).toFixed(1) : "-");
  const daysTotal = openDays().length * runs;
  console.log("\n섹터 소문 적중률 (예고 방향 == 섹터 실제 평균 방향)");
  console.log(
    `  전체 ${pct(rumorStat.all.hit, rumorStat.all.total)}% (n=${rumorStat.all.total})` +
      ` / 진짜 ${pct(rumorStat.real.hit, rumorStat.real.total)}% (n=${rumorStat.real.total})` +
      ` / 가짜 ${pct(rumorStat.fake.hit, rumorStat.fake.total)}% (n=${rumorStat.fake.total})`
  );
  console.log(
    `  하루 평균 소문 수 ${(rumorStat.all.total / daysTotal).toFixed(2)}개` +
      ` (진짜 ${(rumorStat.real.total / daysTotal).toFixed(2)} / 가짜 ${(
        rumorStat.fake.total / daysTotal
      ).toFixed(2)})`
  );

  // 소문교차검증 진입 판정 (초반 시세로 진짜/가짜 거르기) — base 임계 0.5% 기준
  console.log("\n소문교차검증 — 진입 판정 (초반 시세로 진짜/가짜 거르기, 임계 0.5%)");
  console.log(
    `  진입률 ${((skilledStat.entries / skilledStat.days) * 100).toFixed(1)}%` +
      ` / 진입 시 방향 적중 ${pct(skilledStat.correct, skilledStat.entries)}%` +
      ` / 진입이 진짜소문이었던 비율 ${pct(skilledStat.onReal, skilledStat.entries)}%`
  );
  console.log(
    `  → 블라인드 소문(전체 적중 ${pct(rumorStat.all.hit, rumorStat.all.total)}%) 대비 ` +
      `진입 시 적중이 얼마나 높은가 = 교차검증의 실력 가치`
  );

  // 종목뉴스 채널 (Option 2 + 헤드페이크/거래량단서)
  const sn = stockNewsStat;
  console.log("\n종목뉴스 채널 — 톤 적중 & 순진(가격만) vs 실력(가격+거래량)");
  console.log(
    `  톤 적중(톤 방향==종목 실제 방향) ${pct(sn.toneHit, sn.toneN)}% (하루 ${(sn.toneN / daysTotal).toFixed(2)}건)`
  );
  console.log(
    `  순진(가격만)  진입 적중 ${pct(sn.naive.hit, sn.naive.entries)}%` +
      ` / 헤드페이크 함정률 ${pct(sn.naive.trap, sn.naive.entries)}% (진입 ${sn.naive.entries})`
  );
  console.log(
    `  실력(가격+거래량) 진입 적중 ${pct(sn.vol.hit, sn.vol.entries)}%` +
      ` / 헤드페이크 함정률 ${pct(sn.vol.trap, sn.vol.entries)}% (진입 ${sn.vol.entries})`
  );
  console.log(
    `  → 순진 적중이 떨어지고(함정) 실력 적중이 유지되면 = 거래량 단서가 스킬 천장을 올린 것`
  );

  printField(field, rank1, top4, runs, copies);
}

main();

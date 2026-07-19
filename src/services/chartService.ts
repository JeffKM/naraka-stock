import "server-only";
import { CANDLE_INTERVAL_MINUTES, TICKS_PER_CANDLE, bucketOfTick, chartEpochOfSeconds, getKstParts, getTickIndex, ticksPerDay } from "@/lib/market";
import { loadMarketConfig } from "@/lib/marketHours";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// 차트 데이터 (T-402)
//
// 유출 방지가 핵심: 가격 경로는 사전 생성이므로
// - 미래 날짜의 잠정 요약(익일 경로)은 절대 내보내지 않는다
// - 오늘 요약(잠정 종가 포함)은 장 마감(22시) 후에만 내보낸다
// - 오늘 캔들 버킷은 완료된(과거) 버킷까지만 내보낸다
//
// Task 9: 10초 틱 전환으로 종목당 하루 최대 4,320틱 — raw daily_ticks 전 기간
// 조회는 붕괴하므로 폐장 후 1분 단위(종목·일당 최대 720행)로 사전 집계된
// daily_candles를 소스로 쓴다. 단, daily_candles는 배치가 "익일 전체 버킷"을 한 번에
// 미리 넣어두므로(build_daily_candles가 하루치 틱 전부를 한 번에 집계) 오늘
// 날짜의 캔들 행에는 아직 도래하지 않은 미래 버킷도 이미 저장돼 있다. 따라서
// 서비스 레이어에서 "완료된 버킷(bucket < currentBucket)"만 걸러내는 게 유일한
// 유출 방지선이다 — 아래 currentBucket 계산이 그 역할.

export interface DailyCandle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IntradayPoint {
  time: number; // Unix epoch (초)
  price: number;
  volume: number;
}

export interface IntradayOhlc {
  time: number; // Unix epoch (초) — 버킷 시작 시각
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartData {
  daily: DailyCandle[];
  today: IntradayPoint[]; // 라인용: 오늘 1분 틱 (없으면 직전 세션 fallback)
  intradayCandles: IntradayOhlc[]; // 진짜 1분 OHLC 캔들 (최근 INTRADAY_CANDLE_DAYS일로 제한)
}

// intradayCandles 페이로드 크기 제한: 1분봉은 하루 최대 720버킷이라 창을 좁힌다.
// 최근 N일치만 노출(전체 추세는 daily_summary 일봉이 담당).
const INTRADAY_CANDLE_DAYS = 3;

// KST 게임 날짜 + 캔들 버킷(1분 단위) → 차트용 epoch 초 (개장 시각 기준).
// 버킷 폭이 CANDLE_INTERVAL_MINUTES(1분)로 고정이라 bucket * 60초가 성립한다.
function candleTimeEpoch(date: string, bucket: number, openHour: number): number {
  return chartEpochOfSeconds(date, bucket * CANDLE_INTERVAL_MINUTES * 60, openHour);
}

export async function getChartData(stockCode: string, now: Date = new Date()): Promise<ChartData> {
  const supabase = getSupabaseAdmin();
  const { hours, rules } = await loadMarketConfig();
  const { date: today, hour } = getKstParts(now);
  const afterClose = hour >= hours.closeHour;

  // 일봉: 과거 확정분 (+ 마감 후엔 오늘 포함)
  const { data: dailyRows, error: dailyError } = await supabase
    .from("daily_summary")
    .select("date, open, high, low, close, volume")
    .lte("date", afterClose ? today : addDaysStr(today, -1))
    .order("date", { ascending: true });
  if (dailyError) throw dailyError;

  // 오늘 날짜 캔들 중 노출 가능한 버킷 상한(미포함, bucket < maxBucketExclusive).
  // - 마감 후: 오늘 전 버킷(0 ~ totalBuckets-1) 노출 가능
  // - 장중: 완료된 버킷까지만 — 진행 중인 현재 버킷은 미래 종가/고저가를 이미
  //   포함하고 있으므로(daily_candles는 하루치를 배치가 한 번에 사전 집계)
  //   currentBucket 자체도 제외한다(bucket < currentBucket, 포함 아님)
  // - 그 외(개장 전·휴장일 등 getTickIndex가 null): 오늘 버킷 전부 제외
  const totalBuckets = ticksPerDay(hours) / TICKS_PER_CANDLE;
  let maxBucketExclusive: number | null = null;
  if (afterClose) {
    maxBucketExclusive = totalBuckets;
  } else {
    const tickIdx = getTickIndex(now, hours, rules); // 장중이면 현재 틱, 그 외 null
    maxBucketExclusive = tickIdx !== null ? bucketOfTick(tickIdx) : null;
  }

  // 다일 1분 캔들: intradayCandles가 최근 INTRADAY_CANDLE_DAYS일만, today 라인이
  // 오늘(직전 세션 fallback 포함)만 쓰므로 조회 자체를 최근 INTRADAY_CANDLE_DAYS일로
  // 바운드한다(그 안에 직전 세션이 반드시 있어 fallback도 그대로 동작). 미래 날짜는
  // 아예 제외(date <= today). 그래도 종목 1개당 최대
  // 3일 × 720버킷 = 2,160행이라 PostgREST max_rows(로컬
  // config.toml=1000) 상한에 걸릴 수 있어 range로 페이지네이션한다. (date, bucket)
  // 정렬이라 페이지 경계가 날짜 중간에 걸려도 순서가 유지된다.
  const PAGE = 1000;
  type CandleRow = { date: string; bucket: number; open: number; high: number; low: number; close: number; volume: number };
  const candleRows: CandleRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("daily_candles")
      .select("date, bucket, open, high, low, close, volume")
      .eq("stock_code", stockCode)
      .gte("date", addDaysStr(today, -(INTRADAY_CANDLE_DAYS - 1)))
      .lte("date", today)
      .order("date", { ascending: true })
      .order("bucket", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    candleRows.push(...data);
    if (data.length < PAGE) break;
  }

  // 오늘 날짜 버킷은 완료된 버킷(maxBucketExclusive 미만)까지만 노출.
  // maxBucketExclusive가 null이면 오늘 버킷 전부 제외.
  const visibleRows = candleRows.filter((c) =>
    c.date < today ? true : maxBucketExclusive !== null && c.bucket < maxBucketExclusive
  );

  const toPoint = (c: CandleRow): IntradayPoint => ({
    time: candleTimeEpoch(c.date, c.bucket, hours.openHour),
    price: c.close,
    volume: c.volume,
  });

  // 진짜 1분 OHLC 캔들: 최근 INTRADAY_CANDLE_DAYS 거래일치만 노출(페이로드 절감).
  // visibleRows에 이미 미래유출 게이팅(완료 버킷만)이 적용돼 있으므로 그대로 재사용.
  const visibleDates = Array.from(new Set(visibleRows.map((r) => r.date))).sort();
  const recentDates = new Set(visibleDates.slice(-INTRADAY_CANDLE_DAYS));
  const intradayCandles: IntradayOhlc[] = visibleRows
    .filter((r) => recentDates.has(r.date))
    .map((c) => ({
      time: candleTimeEpoch(c.date, c.bucket, hours.openHour),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

  // 라인용 오늘 세션. 오늘 틱이 없으면 직전 세션(마지막 날짜) 라인을 fallback으로 남긴다.
  let lineRows = visibleRows.filter((t) => t.date === today);
  if (lineRows.length === 0 && visibleRows.length > 0) {
    const lastDate = visibleRows[visibleRows.length - 1].date;
    lineRows = visibleRows.filter((t) => t.date === lastDate);
  }
  const todayPoints: IntradayPoint[] = lineRows.map(toPoint);

  return {
    daily: dailyRows
      .filter((d) => d.date <= today)
      .map((d) => ({
        time: d.date,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      })),
    today: todayPoints,
    intradayCandles,
  };
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

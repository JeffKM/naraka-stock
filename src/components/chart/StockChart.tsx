"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuotes } from "@/hooks/useQuotes";
import { getJson } from "@/lib/api/client";
import { chartEpochOfSeconds, formatMoney, getKstParts, TICK_INTERVAL_SECONDS } from "@/lib/market";

interface ChartDto {
  daily: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  today: Array<{ time: number; price: number; volume: number }>; // 라인용: 오늘(없으면 직전 세션)
  intradayCandles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>; // 1분 OHLC 캔들
}

// 차트 색은 globals.css의 --chart-* 토큰이 단일 출처.
// lightweight-charts는 canvas라 CSS 변수를 직접 못 읽으므로 마운트 시 getComputedStyle로 읽어 주입한다.
type ChartColors = {
  text: string;
  grid: string;
  up: string;
  down: string;
  area: string;
  areaTop: string;
  areaBottom: string;
  volUp: string;
  volDown: string;
  volNeutral: string;
  high: string;
  low: string;
};

function readChartColors(el: HTMLElement): ChartColors {
  const s = getComputedStyle(el);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    text: v("--chart-text"),
    grid: v("--chart-grid"),
    up: v("--chart-up"),
    down: v("--chart-down"),
    area: v("--chart-area"),
    areaTop: v("--chart-area-top"),
    areaBottom: v("--chart-area-bottom"),
    volUp: v("--chart-vol-up"),
    volDown: v("--chart-vol-down"),
    volNeutral: v("--chart-vol-neutral"),
    high: v("--chart-high"),
    low: v("--chart-low"),
  };
}

// 라인(당일) / 1분·N분 OHLC 캔들(1분봉을 N개 집계) / 일봉 캔들
type Mode = "line" | "m1" | "m5" | "m15" | "m30" | "m60" | "daily";

// m1은 원본 1분봉을 그대로 쓰고, 나머지는 1분봉 N개를 묶어 재집계한다.
const MINUTES_BY_MODE: Record<Exclude<Mode, "line" | "daily" | "m1">, number> = {
  m5: 5,
  m15: 15,
  m30: 30,
  m60: 60,
};

interface IntradayCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 일봉(문자열 날짜) / 분봉(초 단위 epoch) 시간 값을 함께 다루기 위한 공용 타입
type CandleTime = number | string;

interface ChartCandle {
  time: CandleTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 크로스헤어 hover 시 오버레이에 표시할 봉 데이터 (라인 모드는 o/h/l 없이 가격+거래량만)
interface HoverInfo {
  o?: number;
  h?: number;
  l?: number;
  c: number;
  v: number;
}

// lightweight-charts의 Time(숫자/문자열/BusinessDay)을 Map 키로 쓸 수 있게 문자열로 정규화
function timeKey(t: number | string | { year: number; month: number; day: number }): string {
  if (typeof t === "number" || typeof t === "string") return String(t);
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

// 1분 OHLC 캔들을 n분 봉으로 재집계 (개장이 정시라 버킷 경계가 항상 맞아떨어진다).
// open=첫 캔들의 open, high/low=구간 내 최대/최소, close=마지막 캔들의 close, volume=합산 —
// 종가 포인트만 이어붙이는 것보다 정확한 OHLC가 나온다.
function aggregateOhlcCandles(candles: IntradayCandle[], minutes: number): IntradayCandle[] {
  const bucketSec = minutes * 60;
  const out: IntradayCandle[] = [];
  for (const c of candles) {
    const start = Math.floor(c.time / bucketSec) * bucketSec;
    const last = out[out.length - 1];
    if (last && last.time === start) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ time: start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    }
  }
  return out;
}

// 종목 차트 (T-402/T-801): 당일 라인 + 분봉 캔들 + 일봉 캔들 + 거래량 히스토그램 + OHLCV 툴팁 + 고저 마커
export function StockChart({ code }: { code: string }) {
  const [mode, setMode] = useState<Mode>("line");
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const { data: board } = useQuotes();

  // 라인 tip: 현재 종목의 10초 현재가를 라인 끝에 얹기 위한 {time, value}.
  // time은 서버 candleTimeEpoch와 동일 규약(chartEpochOfSeconds). tickIndex는 서버가
  // 전체 개장일 규칙(extraOpenDays/holidayExceptions 포함)으로 계산·클램프해 내려준
  // 값을 그대로 쓴다 — 클라에서 재판정하면 QuoteBoardDto가 노출하지 않는 규칙 때문에
  // 오판(휴장으로 잘못 판정)할 수 있다. 현재 틱 클램프는 서버가 이미 했으므로 미래
  // 틱은 절대 새지 않는다(원칙 2). 장중·해당 종목 시세가 있을 때만 non-null.
  const liveTip = useMemo(() => {
    if (mode !== "line" || !board || board.marketState !== "open" || board.tickIndex === null) return null;
    const q = board.quotes.find((x) => x.code === code);
    if (!q) return null;
    const { date } = getKstParts(new Date(board.asOf));
    return { time: chartEpochOfSeconds(date, board.tickIndex * TICK_INTERVAL_SECONDS, board.market.openHour), value: q.price };
  }, [board, mode, code]);

  const { data, isLoading } = useQuery({
    queryKey: ["chart", code],
    queryFn: () => getJson<ChartDto>(`/api/stocks/${code}/chart`),
    refetchInterval: 60_000, // 완료된 1분봉 갱신 — 라인 끝 tip은 useQuotes(10초)가 담당
  });

  useEffect(() => {
    if (!containerRef.current || !data) return;

    const colors = readChartColors(containerRef.current);

    const chart = createChart(containerRef.current, {
      // 컨테이너 CSS 높이(반응형)를 따라감 — 너비·높이 모두 ResizeObserver로 자동 추종
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: colors.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      // 가격 캔들을 하단 거래량 밴드 위로 띄워 가격축 라벨·거래량 겹침 방지
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.28 } },
      timeScale: { borderVisible: false, timeVisible: mode !== "daily" },
    });
    chartRef.current = chart;

    // 가격 시리즈 (라인 또는 캔들) — 고저 마커·툴팁이 참조할 수 있도록 상위 스코프에 유지
    const priceSeries =
      mode === "line"
        ? chart.addSeries(AreaSeries, {
            lineColor: colors.area,
            topColor: colors.areaTop,
            bottomColor: colors.areaBottom,
            lineWidth: 2,
          })
        : chart.addSeries(CandlestickSeries, {
            upColor: colors.up,
            downColor: colors.down,
            borderVisible: false,
            wickUpColor: colors.up,
            wickDownColor: colors.down,
          });

    if (mode === "line") {
      lineSeriesRef.current = priceSeries as ISeriesApi<"Area">;
    }

    // 캔들 데이터(일봉/1분/N분 집계) — 라인 모드에서는 빈 배열. 일봉은 날짜 문자열, 나머지는 초 단위 epoch.
    // m1은 서버가 내려주는 원본 1분봉을 그대로 쓰고, m5/m15/m30/m60은 1분봉을 N개씩 묶어 재집계한다.
    const candleData: ChartCandle[] =
      mode === "daily"
        ? data.daily.map((d) => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }))
        : mode === "line"
          ? []
          : mode === "m1"
            ? data.intradayCandles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }))
            : aggregateOhlcCandles(data.intradayCandles, MINUTES_BY_MODE[mode as "m5" | "m15" | "m30" | "m60"]);

    if (mode === "line") {
      priceSeries.setData(
        // lightweight-charts는 UTCTimestamp 초 단위를 받는다
        data.today.map((t) => ({ time: t.time as never, value: t.price }))
      );
    } else {
      priceSeries.setData(
        candleData.map((c) => ({
          time: c.time as never,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
    }

    // 거래량 히스토그램 — 하단 20% 별도 price scale
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: colors.volNeutral,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const volData =
      mode === "line"
        ? data.today.map((t) => ({ time: t.time as never, value: t.volume, color: colors.volNeutral }))
        : candleData.map((c) => ({
            time: c.time as never,
            value: c.volume,
            color: c.close >= c.open ? colors.volUp : colors.volDown,
          }));
    volSeries.setData(volData);

    // 최고·최저가 price line (고저 마커)
    const highs = mode === "daily" ? data.daily.map((d) => d.high) : mode === "line" ? data.today.map((t) => t.price) : candleData.map((c) => c.high);
    const lows = mode === "daily" ? data.daily.map((d) => d.low) : mode === "line" ? data.today.map((t) => t.price) : candleData.map((c) => c.low);
    if (highs.length) {
      priceSeries.createPriceLine({
        price: Math.max(...highs),
        color: colors.high,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "고",
      });
      priceSeries.createPriceLine({
        price: Math.min(...lows),
        color: colors.low,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "저",
      });
    }

    // 크로스헤어 hover 시 시/고/저/종/거래량 오버레이 — 시간 값을 문자열 키로 정규화해 일봉(날짜 문자열)·분봉(epoch 초) 모두 대응
    const byTime = new Map<string, HoverInfo>();
    if (mode === "line") {
      data.today.forEach((t) => byTime.set(timeKey(t.time), { c: t.price, v: t.volume }));
    } else {
      candleData.forEach((c) => byTime.set(timeKey(c.time), { o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }));
    }
    const handleCrosshairMove = (param: Parameters<Parameters<IChartApi["subscribeCrosshairMove"]>[0]>[0]) => {
      if (param.time == null) {
        setHover(null);
        return;
      }
      const key = timeKey(param.time as number | string | { year: number; month: number; day: number });
      setHover(byTime.get(key) ?? null);
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    chart.timeScale().fitContent();

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      lineSeriesRef.current = null;
      setHover(null);
    };
  }, [data, mode]);

  // 라이브 tip 반영: 10초마다 board가 갱신되면 라인 끝 점만 update. 빌드 effect가
  // data/mode 변화로 시리즈를 다시 만든 직후에도 재적용되도록 data를 의존에 둔다.
  useEffect(() => {
    if (!liveTip) return;
    const series = lineSeriesRef.current;
    if (!series) return;
    // board(tip)와 data(라인)가 폴링 타이밍으로 엇갈리면 스테일 tip이 라인 마지막
    // 완료점보다 과거일 수 있다. lightweight-charts는 마지막 시각 이전 update를 throw하고
    // (error boundary 부재 → 상세 화면 크래시), 이를 tip이 라인 끝보다 뒤일 때만 반영해 막는다.
    const lastTime = data?.today.at(-1)?.time ?? Number.NEGATIVE_INFINITY;
    if (liveTip.time <= lastTime) return;
    series.update({ time: liveTip.time as never, value: liveTip.value });
  }, [liveTip, data]);

  // 라인은 오늘(없으면 fallback) 세션, m1/m5/m15/m30/m60 분봉은 1분 OHLC 캔들(다일 누적, 최근 N일)을 소스로 쓴다.
  // 각각 실제로 그릴 데이터가 하나도 없을 때만 빈 화면을 띄운다. 장중 첫 1분처럼 today가
  // 비어도 liveTip이 있으면 빈 화면을 띄우지 않는다.
  const chartEmpty =
    data &&
    ((mode === "line" && data.today.length === 0 && !liveTip) ||
      (mode !== "line" && mode !== "daily" && data.intradayCandles.length === 0));

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="line">라인</TabsTrigger>
            <TabsTrigger value="m1">1분</TabsTrigger>
            <TabsTrigger value="m5">5분</TabsTrigger>
            <TabsTrigger value="m15">15분</TabsTrigger>
            <TabsTrigger value="m30">30분</TabsTrigger>
            <TabsTrigger value="m60">1시간</TabsTrigger>
            <TabsTrigger value="daily">일봉</TabsTrigger>
          </TabsList>
        </Tabs>
        {isLoading && <Skeleton className="h-[280px] w-full md:h-[360px]" />}
        {chartEmpty && (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground md:h-[360px]">
            곧 첫 장이 열려요
          </div>
        )}
        <div className="relative">
          {/* autoSize가 이 컨테이너 높이를 따라감 — 반응형 높이(모바일 280 / PC 360) */}
          <div
            ref={containerRef}
            className={chartEmpty || isLoading ? "hidden" : "h-[280px] md:h-[360px]"}
          />
          {hover && !chartEmpty && !isLoading && (
            <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-background/90 px-2 py-1 text-xs tabular-nums shadow">
              {hover.o != null && (
                <span>
                  시 {formatMoney(hover.o)} · 고 {formatMoney(hover.h!)} · 저 {formatMoney(hover.l!)} · 종{" "}
                  {formatMoney(hover.c)} ·{" "}
                </span>
              )}
              {hover.o == null && <span>가 {formatMoney(hover.c)} · </span>}
              거래량 {hover.v.toLocaleString()}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

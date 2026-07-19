"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type IChartApi,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";

interface ChartDto {
  daily: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  today: Array<{ time: number; price: number; volume: number }>; // 라인용: 오늘(없으면 직전 세션)
  intraday: Array<{ time: number; price: number; volume: number }>; // 분봉 집계 소스: 다일 누적
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

// 라인(당일) / 분봉 캔들(5분 틱 집계) / 일봉 캔들
type Mode = "line" | "m15" | "m30" | "m60" | "daily";

const MINUTES_BY_MODE: Record<Exclude<Mode, "line" | "daily">, number> = {
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

// 5분 틱을 n분 봉으로 집계 (개장 15:00이 정시라 버킷 경계가 항상 맞아떨어진다)
function aggregateCandles(
  points: Array<{ time: number; price: number; volume: number }>,
  minutes: number
): IntradayCandle[] {
  const bucketSec = minutes * 60;
  const candles: IntradayCandle[] = [];
  for (const p of points) {
    const start = Math.floor(p.time / bucketSec) * bucketSec;
    const last = candles[candles.length - 1];
    if (last && last.time === start) {
      last.high = Math.max(last.high, p.price);
      last.low = Math.min(last.low, p.price);
      last.close = p.price;
      last.volume += p.volume;
    } else {
      candles.push({ time: start, open: p.price, high: p.price, low: p.price, close: p.price, volume: p.volume });
    }
  }
  return candles;
}

// 종목 차트 (T-402/T-801): 당일 라인 + 분봉 캔들 + 일봉 캔들 + 거래량 히스토그램 + OHLCV 툴팁 + 고저 마커
export function StockChart({ code }: { code: string }) {
  const [mode, setMode] = useState<Mode>("line");
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["chart", code],
    queryFn: () => getJson<ChartDto>(`/api/stocks/${code}/chart`),
    refetchInterval: 5 * 60_000, // 틱 주기와 동일
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

    // 캔들 데이터(일봉/분봉 집계) — 라인 모드에서는 빈 배열. 일봉은 날짜 문자열, 분봉은 초 단위 epoch 시간을 그대로 유지한다
    const candleData: ChartCandle[] =
      mode === "daily"
        ? data.daily.map((d) => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume }))
        : mode === "line"
          ? []
          : aggregateCandles(data.intraday, MINUTES_BY_MODE[mode as "m15" | "m30" | "m60"]);

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
      setHover(null);
    };
  }, [data, mode]);

  // 라인은 오늘(없으면 fallback) 세션, 분봉은 다일 누적을 소스로 쓴다.
  // 각각 실제로 그릴 데이터가 하나도 없을 때만 빈 화면을 띄운다.
  const chartEmpty =
    data &&
    ((mode === "line" && data.today.length === 0) ||
      (mode !== "line" && mode !== "daily" && data.intraday.length === 0));

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="line">라인</TabsTrigger>
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

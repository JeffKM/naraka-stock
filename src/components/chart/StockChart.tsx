"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  type IChartApi,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getJson } from "@/lib/api/client";

interface ChartDto {
  daily: Array<{ time: string; open: number; high: number; low: number; close: number }>;
  today: Array<{ time: number; price: number }>;
}

// 다크 테마 차트 색 (globals.css 팔레트와 톤 일치)
const CHART_COLORS = {
  text: "#b8ada3",
  grid: "rgba(184, 173, 163, 0.08)",
  up: "#e05c4f", // bull
  down: "#5b8cc9", // bear
  area: "#c04a3e",
};

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
}

// 5분 틱을 n분 봉으로 집계 (개장 15:00이 정시라 버킷 경계가 항상 맞아떨어진다)
function aggregateCandles(
  points: Array<{ time: number; price: number }>,
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
    } else {
      candles.push({ time: start, open: p.price, high: p.price, low: p.price, close: p.price });
    }
  }
  return candles;
}

// 종목 차트 (T-402/T-801): 당일 라인 + 분봉 캔들 + 일봉 캔들
export function StockChart({ code }: { code: string }) {
  const [mode, setMode] = useState<Mode>("line");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["chart", code],
    queryFn: () => getJson<ChartDto>(`/api/stocks/${code}/chart`),
    refetchInterval: 5 * 60_000, // 틱 주기와 동일
  });

  useEffect(() => {
    if (!containerRef.current || !data) return;

    const chart = createChart(containerRef.current, {
      height: 220,
      layout: {
        background: { color: "transparent" },
        textColor: CHART_COLORS.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: CHART_COLORS.grid },
        horzLines: { color: CHART_COLORS.grid },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: mode !== "daily" },
    });
    chartRef.current = chart;

    if (mode === "line") {
      const series = chart.addSeries(AreaSeries, {
        lineColor: CHART_COLORS.area,
        topColor: "rgba(192, 74, 62, 0.35)",
        bottomColor: "rgba(192, 74, 62, 0.02)",
        lineWidth: 2,
      });
      series.setData(
        // lightweight-charts는 UTCTimestamp 초 단위를 받는다
        data.today.map((t) => ({ time: t.time as never, value: t.price }))
      );
    } else {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: CHART_COLORS.up,
        downColor: CHART_COLORS.down,
        borderVisible: false,
        wickUpColor: CHART_COLORS.up,
        wickDownColor: CHART_COLORS.down,
      });
      if (mode === "daily") {
        series.setData(
          data.daily.map((d) => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          }))
        );
      } else {
        series.setData(
          aggregateCandles(data.today, MINUTES_BY_MODE[mode]).map((c) => ({
            ...c,
            time: c.time as never,
          }))
        );
      }
    }
    chart.timeScale().fitContent();

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, mode]);

  const todayEmpty = mode !== "daily" && data && data.today.length === 0;

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
        {isLoading && <Skeleton className="h-[220px] w-full" />}
        {todayEmpty && (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            아직 오늘 장이 열리지 않았습니다 🌙
          </div>
        )}
        <div ref={containerRef} className={todayEmpty || isLoading ? "hidden" : ""} />
      </CardContent>
    </Card>
  );
}

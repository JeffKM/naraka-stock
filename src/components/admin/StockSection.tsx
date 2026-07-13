"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getJson, postJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";
import { useQuotes } from "@/hooks/useQuotes";

const TIER_OPTIONS = [
  { value: "stable", label: "우량주" },
  { value: "normal", label: "일반주" },
  { value: "wild", label: "테마주" },
] as const;

const TIER_LABEL: Record<string, string> = {
  stable: "우량주",
  normal: "일반주",
  wild: "테마주",
};

// 시세 조정 적용 시간 선택지 (30분 단위, ""는 남은 시간 전체)
const DURATION_OPTIONS = [30, 60, 90, 120, 150, 180] as const;

interface AdminStock {
  code: string;
  name: string;
  tier: string;
}

// 종목 관리: 검색 + 종목별 상세(등급 변경·시세 조정) + 신규 상장
export function StockSection() {
  const [search, setSearch] = useState("");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const { data: quotes } = useQuotes();

  const { data } = useQuery({
    queryKey: ["admin-stocks"],
    queryFn: () => getJson<{ stocks: AdminStock[] }>("/api/admin/stocks"),
  });

  // 등급 변경 후에도 다이얼로그가 최신 값을 보여주도록 목록에서 파생
  const selected = data?.stocks.find((s) => s.code === selectedCode) ?? null;

  const keyword = search.trim().toLowerCase();
  const filtered = (data?.stocks ?? []).filter(
    (s) =>
      !keyword ||
      s.name.toLowerCase().includes(keyword) ||
      s.code.toLowerCase().includes(keyword)
  );

  const quoteOf = (code: string) => quotes?.quotes.find((q) => q.code === code);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">종목 관리</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input
          placeholder="종목명·코드 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex flex-col divide-y divide-border/60">
          {filtered.map((s) => {
            const quote = quoteOf(s.code);
            return (
              <button
                key={s.code}
                onClick={() => setSelectedCode(s.code)}
                className="flex items-center justify-between gap-2 py-2.5 text-left transition-colors hover:bg-accent/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {s.code}
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {TIER_LABEL[s.tier] ?? s.tier}
                  </Badge>
                </span>
                {quote && (
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    {formatMoney(quote.price)}{" "}
                    <span
                      className={
                        quote.changePercent > 0
                          ? "text-bull"
                          : quote.changePercent < 0
                            ? "text-bear"
                            : "text-muted-foreground"
                      }
                    >
                      {quote.changePercent > 0 ? "+" : ""}
                      {quote.changePercent}%
                    </span>
                  </span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              검색 결과가 없습니다
            </p>
          )}
        </div>

        <StockDialog stock={selected} onClose={() => setSelectedCode(null)} />
        <ListingForm />
      </CardContent>
    </Card>
  );
}

// 종목 상세 다이얼로그: 등급 변경 + 시세 조정
function StockDialog({
  stock,
  onClose,
}: {
  stock: AdminStock | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: quotes } = useQuotes();
  const [bias, setBias] = useState("-30");
  const [duration, setDuration] = useState("");
  const [busy, setBusy] = useState(false);

  const quote = stock ? quotes?.quotes.find((q) => q.code === stock.code) : undefined;

  async function changeTier(tier: string) {
    if (!stock) return;
    try {
      const res = await fetch("/api/admin/stocks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: stock.code, tier }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success(`${stock.name} 등급 변경 완료 (다음 배치 경로부터 반영)`);
      queryClient.invalidateQueries({ queryKey: ["admin-stocks"] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "변경 실패");
    }
  }

  async function steerPrice() {
    if (!stock || busy) return;
    setBusy(true);
    try {
      const durationMinutes = duration === "" ? null : Number(duration);
      const result = await postJson<{ fromTick: number; replaced: number }>(
        "/api/admin/surprise",
        { stockCode: stock.code, bias: Number(bias), durationMinutes }
      );
      const range = durationMinutes ? `${durationMinutes}분간` : "남은 시간 전체";
      toast.success(
        `${stock.name} 시세 조정 (${range}, 틱 ${result.fromTick} 이후 ${result.replaced}개 재생성)`
      );
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["chart", stock.code] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!stock} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        {stock && (
          <>
            <DialogHeader>
              <DialogTitle>
                {stock.name}{" "}
                <span className="font-mono text-sm text-muted-foreground">
                  {stock.code}
                </span>
              </DialogTitle>
              <DialogDescription>
                {quote
                  ? `현재가 ${formatMoney(quote.price)} (${quote.changePercent > 0 ? "+" : ""}${quote.changePercent}%)`
                  : "현재 시세 없음"}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-sm text-muted-foreground">종류</span>
                <select
                  value={stock.tier}
                  onChange={(e) => changeTier(e.target.value)}
                  className="flex-1 rounded-lg border bg-background px-2 py-1.5 text-sm"
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
                <p className="text-sm font-medium">시세 조정</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={bias}
                    onChange={(e) => setBias(e.target.value)}
                    className="w-24"
                    placeholder="편향 %"
                  />
                  <select
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="flex-1 rounded-lg border bg-background px-2 text-sm"
                  >
                    <option value="">남은 시간 전체</option>
                    {DURATION_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}분
                      </option>
                    ))}
                  </select>
                  <Button onClick={steerPrice} disabled={busy}>
                    발동
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  지정 시간 동안 편향을 걸어 오늘 남은 경로를 다시 뽑습니다. 시간이
                  지나면 그날 추첨된 원래 편향 흐름으로 복귀합니다 (장중에만 가능)
                </p>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// 신규 상장 폼
function ListingForm() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: "",
    name: "",
    tier: "normal",
    description: "",
    price: "",
    shares: "",
  });

  async function listStock() {
    try {
      const result = await postJson<{ tradableNow: boolean }>("/api/admin/stocks", {
        code: form.code.toUpperCase().trim(),
        name: form.name.trim(),
        tier: form.tier,
        description: form.description.trim(),
        initialPrice: Number(form.price),
        sharesOutstanding: Number(form.shares),
      });
      toast.success(
        result.tradableNow
          ? "상장 완료! 지금 바로 거래 가능합니다"
          : "상장 완료! 다음 개장일부터 거래됩니다"
      );
      setForm({ code: "", name: "", tier: "normal", description: "", price: "", shares: "" });
      queryClient.invalidateQueries({ queryKey: ["admin-stocks"] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "상장 실패");
    }
  }

  const canSubmit =
    form.code.trim() &&
    form.name.trim() &&
    Number(form.price) >= 100 &&
    Number(form.shares) >= 10_000;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">신규 상장</p>
      <div className="flex gap-2">
        <Input
          placeholder="코드 (예: DKBI)"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          className="w-32 font-mono"
          maxLength={6}
        />
        <Input
          placeholder="종목명"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="flex gap-2">
        <select
          value={form.tier}
          onChange={(e) => setForm({ ...form, tier: e.target.value })}
          className="rounded-lg border bg-background px-2 text-sm"
        >
          {TIER_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <Input
          type="number"
          placeholder="상장가 (원)"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />
        <Input
          type="number"
          placeholder="발행주식수"
          value={form.shares}
          onChange={(e) => setForm({ ...form, shares: e.target.value })}
        />
      </div>
      <Input
        placeholder="한 줄 소개 (선택)"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
      />
      <Button onClick={listStock} disabled={!canSubmit}>
        상장하기
      </Button>
      <p className="text-xs text-muted-foreground">
        장중 상장 시 즉시 거래 가능. 신규 종목은 자동 힌트 뉴스가 없으니 수동 뉴스로
        띄워주세요.
      </p>
    </div>
  );
}

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson, postJson } from "@/lib/api/client";

const TIER_OPTIONS = [
  { value: "stable", label: "우량주" },
  { value: "normal", label: "일반주" },
  { value: "wild", label: "테마주" },
] as const;

// 종목 관리: 등급 변경 + 신규 상장
export function StockSection() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: "",
    name: "",
    tier: "normal",
    description: "",
    price: "",
    shares: "",
  });

  const { data } = useQuery({
    queryKey: ["admin-stocks"],
    queryFn: () =>
      getJson<{
        stocks: Array<{ code: string; name: string; tier: string }>;
      }>("/api/admin/stocks"),
  });

  async function changeTier(code: string, tier: string) {
    try {
      const res = await fetch("/api/admin/stocks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, tier }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success(`${code} 등급 변경 완료 (다음 배치 경로부터 반영)`);
      queryClient.invalidateQueries({ queryKey: ["admin-stocks"] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "변경 실패");
    }
  }

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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">종목 관리</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col divide-y divide-border/60">
          {data?.stocks.map((s) => (
            <div key={s.code} className="flex items-center justify-between py-2">
              <span className="font-medium">
                {s.name} <span className="text-xs text-muted-foreground">{s.code}</span>
              </span>
              <select
                value={s.tier}
                onChange={(e) => changeTier(s.code, e.target.value)}
                className="rounded-lg border bg-background px-2 py-1 text-sm"
              >
                {TIER_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
          <p className="text-sm font-medium">✨ 신규 상장</p>
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
      </CardContent>
    </Card>
  );
}

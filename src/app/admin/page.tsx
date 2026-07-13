"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson, postJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";
import { useQuotes } from "@/hooks/useQuotes";
import type { Me } from "@/types/domain";

// 어드민 콘솔 (T-602~T-605). 최종 권한 검증은 모든 /api/admin/* 의 requireAdmin이 담당.
export default function AdminPage() {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => getJson<Me>("/api/auth/me"),
    retry: false,
  });

  if (isLoading) return null;
  if (!me?.isAdmin) {
    return <p className="py-16 text-center text-muted-foreground">접근 권한이 없습니다 👺</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">운영자 콘솔</h1>
      <DashboardSection />
      <RankingSection />
      <MarketSection />
      <StockSection />
      <SignupCodeSection />
      <VisitCodeSection />
      <EventSection />
      <ManualNewsSection />
      <UserSection />
      <ResetSection />
    </div>
  );
}

interface MarketSettingsDto {
  openHour: number;
  closeHour: number;
  closedWeekdays: number[];
  holidayExceptions: string[];
  extraOpenDays: string[];
  today: string; // 오늘 날짜 (KST)
  todayOverride: { openHour: number; closeHour: number } | null;
}

const WEEKDAYS = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 7, label: "일" },
] as const;

// 장 운영 설정: 개장/마감 시간·정기 휴장 요일·예외일 (Phase 8)
function MarketSection() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<MarketSettingsDto | null>(null);
  const [holidayInput, setHolidayInput] = useState("");
  const [extraInput, setExtraInput] = useState("");
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin-market"],
    queryFn: () => getJson<MarketSettingsDto>("/api/admin/market"),
  });
  const settings = form ?? data;

  function edit(patch: Partial<MarketSettingsDto>) {
    if (!settings) return;
    setForm({ ...settings, ...patch });
  }

  function toggleWeekday(day: number) {
    if (!settings) return;
    const closed = settings.closedWeekdays.includes(day)
      ? settings.closedWeekdays.filter((d) => d !== day)
      : [...settings.closedWeekdays, day].sort();
    edit({ closedWeekdays: closed });
  }

  async function save() {
    if (!settings || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/market", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success("저장 완료 — 장 시간 변경은 다음 배치 경로부터 완전 반영됩니다");
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["admin-market"] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  const dateChips = (
    list: string[],
    onRemove: (d: string) => void
  ) =>
    list.map((d) => (
      <Badge key={d} variant="secondary" className="gap-1">
        {d}
        <button onClick={() => onRemove(d)} aria-label={`${d} 삭제`}>
          ✕
        </button>
      </Badge>
    ));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">장 운영 설정</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-sm text-muted-foreground">장 시간</span>
          <Input
            type="number"
            min={0}
            max={23}
            value={settings.openHour}
            onChange={(e) => edit({ openHour: Number(e.target.value) })}
            className="w-20"
          />
          <span className="text-sm text-muted-foreground">시 ~</span>
          <Input
            type="number"
            min={1}
            max={24}
            value={settings.closeHour}
            onChange={(e) => edit({ closeHour: Number(e.target.value) })}
            className="w-20"
          />
          <span className="text-sm text-muted-foreground">
            시 ({(settings.closeHour - settings.openHour) * 12}틱/일)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-sm text-muted-foreground">정기 휴장 요일</span>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d) => (
              <Button
                key={d.value}
                size="sm"
                variant={settings.closedWeekdays.includes(d.value) ? "destructive" : "outline"}
                onClick={() => toggleWeekday(d.value)}
                className="h-7 w-9 px-0"
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>
        <p className="-mt-2 pl-24 text-xs text-muted-foreground">
          빨간 요일이 휴장입니다. 없으면 매일 개장.
        </p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-sm text-muted-foreground">임시 휴장일</span>
            <Input
              type="date"
              value={holidayInput}
              onChange={(e) => setHolidayInput(e.target.value)}
              className="w-40"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!holidayInput}
              onClick={() => {
                edit({
                  holidayExceptions: [
                    ...new Set([...settings.holidayExceptions, holidayInput]),
                  ].sort(),
                });
                setHolidayInput("");
              }}
            >
              추가
            </Button>
          </div>
          {settings.holidayExceptions.length > 0 && (
            <div className="flex flex-wrap gap-1 pl-24">
              {dateChips(settings.holidayExceptions, (d) =>
                edit({
                  holidayExceptions: settings.holidayExceptions.filter((x) => x !== d),
                })
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-sm text-muted-foreground">임시 개장일</span>
            <Input
              type="date"
              value={extraInput}
              onChange={(e) => setExtraInput(e.target.value)}
              className="w-40"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!extraInput}
              onClick={() => {
                edit({
                  extraOpenDays: [...new Set([...settings.extraOpenDays, extraInput])].sort(),
                });
                setExtraInput("");
              }}
            >
              추가
            </Button>
          </div>
          {settings.extraOpenDays.length > 0 && (
            <div className="flex flex-wrap gap-1 pl-24">
              {dateChips(settings.extraOpenDays, (d) =>
                edit({ extraOpenDays: settings.extraOpenDays.filter((x) => x !== d) })
              )}
            </div>
          )}
        </div>

        <Button onClick={save} disabled={!form || saving}>
          {saving ? "저장 중..." : "저장"}
        </Button>
        <p className="text-xs text-muted-foreground">
          장 시간을 바꾸면 <b>다음 22:00 배치가 만드는 경로부터</b> 새 틱 수로 생성됩니다.
          이미 생성된 오늘 경로는 그대로라, 장을 늘리면 남는 시간은 종가로 고정 표시됩니다.
        </p>

        <TodayHoursBlock settings={settings} />
      </CardContent>
    </Card>
  );
}

// 오늘 하루만 장 시간 변경 (자정 폐장 후 ~ 당일 개장 전에만 적용/해제 가능)
function TodayHoursBlock({ settings }: { settings: MarketSettingsDto }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{ openHour: number; closeHour: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const hours =
    form ??
    settings.todayOverride ?? {
      openHour: settings.openHour,
      closeHour: settings.closeHour,
    };

  async function request(init: RequestInit, successMessage: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/market/today", init);
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success(successMessage);
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["admin-market"] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  const apply = () =>
    request(
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hours),
      },
      `오늘(${settings.today})만 ${hours.openHour}시~${hours.closeHour}시로 엽니다`
    );
  const clear = () => request({ method: "DELETE" }, "오늘 장 시간을 기본값으로 되돌렸습니다");

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">
        🌗 오늘({settings.today})만 장 시간 변경{" "}
        {settings.todayOverride && (
          <Badge variant="secondary">
            적용 중 {settings.todayOverride.openHour}시~{settings.todayOverride.closeHour}시
          </Badge>
        )}
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={23}
          value={hours.openHour}
          onChange={(e) => setForm({ ...hours, openHour: Number(e.target.value) })}
          className="w-20"
        />
        <span className="text-sm text-muted-foreground">시 ~</span>
        <Input
          type="number"
          min={1}
          max={24}
          value={hours.closeHour}
          onChange={(e) => setForm({ ...hours, closeHour: Number(e.target.value) })}
          className="w-20"
        />
        <span className="text-sm text-muted-foreground">시</span>
        <Button size="sm" onClick={apply} disabled={busy}>
          오늘만 적용
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={clear}
          disabled={busy || !settings.todayOverride}
        >
          해제
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        자정 폐장 후 ~ 당일 개장 전에만 바꿀 수 있습니다. 바꾸지 않으면 위 기본 장
        시간대로 열리고, 날짜가 지나면 자동으로 풀립니다.
      </p>
    </div>
  );
}

// 리허설 데이터 초기화 (개장 전 1회, 파괴적 작업)
function ResetSection() {
  const queryClient = useQueryClient();
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);

  async function reset() {
    if (confirmText !== "초기화" || running) return;
    setRunning(true);
    try {
      const result = await postJson<{
        usersDeleted: number;
        tradesDeleted: number;
        newsDeleted: number;
      }>("/api/admin/reset", { confirm: confirmText });
      toast.success(
        `초기화 완료 — 유저 ${result.usersDeleted}명, 거래 ${result.tradesDeleted}건, 뉴스 ${result.newsDeleted}건 삭제`
      );
      setConfirmText("");
      queryClient.invalidateQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "초기화 실패");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">
          ⚠️ 리허설 데이터 초기화
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          개장(8/1) 전 마지막 준비 단계입니다. 일반 유저 계정·거래·뉴스·가격 데이터를 모두
          지우고 기준가만 남깁니다. <b>어드민 계정·미사용 가입 코드·방문 코드는 유지</b>
          됩니다. 되돌릴 수 없습니다.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder='확인 문구 "초기화" 입력'
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <Button
            variant="destructive"
            onClick={reset}
            disabled={confirmText !== "초기화" || running}
          >
            {running ? "초기화 중..." : "실행"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardSection() {
  const { data } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () =>
      getJson<{
        userCount: number;
        todayTradeCount: number;
        todayTradeVolume: number;
        unusedSignupCodes: number;
        todayVisitClaims: number;
      }>("/api/admin/dashboard"),
    refetchInterval: 60_000,
  });

  const stats = [
    { label: "가입자", value: data?.userCount },
    { label: "오늘 체결", value: data?.todayTradeCount },
    { label: "오늘 거래대금", value: data ? formatMoney(data.todayTradeVolume) : undefined },
    { label: "미사용 가입코드", value: data?.unusedSignupCodes },
    { label: "오늘 방문 보너스", value: data?.todayVisitClaims },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">대시보드</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="font-semibold">{s.value ?? "—"}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// 총자산 랭킹 (운영자 전용 — 순위는 매장에서 발표)
function RankingSection() {
  const { data } = useQuery({
    queryKey: ["admin-ranking"],
    queryFn: () =>
      getJson<{
        top: Array<{ rank: number; nickname: string; totalAssets: number }>;
        totalUsers: number;
      }>("/api/ranking"),
    refetchInterval: 60_000,
  });

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          랭킹{" "}
          <span className="text-sm font-normal text-muted-foreground">
            참가자 {data?.totalUsers ?? "—"}명
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border/60">
        {data?.top.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">아직 참가자가 없습니다</p>
        )}
        {data?.top.map((entry) => (
          <div key={entry.rank} className="flex items-center justify-between py-2">
            <span>
              <span className="mr-2 inline-block w-7 text-center font-bold">
                {medals[entry.rank - 1] ?? entry.rank}
              </span>
              {entry.nickname}
            </span>
            <span className="tabular-nums text-sm">{formatMoney(entry.totalAssets)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const TIER_OPTIONS = [
  { value: "stable", label: "우량주" },
  { value: "normal", label: "일반주" },
  { value: "wild", label: "테마주" },
] as const;

// 종목 관리: 등급 변경 + 신규 상장
function StockSection() {
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

function SignupCodeSection() {
  const queryClient = useQueryClient();
  const [count, setCount] = useState("20");
  const [newCodes, setNewCodes] = useState<string[]>([]);

  const { data } = useQuery({
    queryKey: ["admin-signup-codes"],
    queryFn: () =>
      getJson<{ unused: number; used: number }>("/api/admin/signup-codes"),
  });

  async function generate() {
    try {
      const { codes } = await postJson<{ codes: string[] }>("/api/admin/signup-codes", {
        count: Number(count),
      });
      setNewCodes(codes);
      toast.success(`가입 코드 ${codes.length}개 생성 완료`);
      queryClient.invalidateQueries({ queryKey: ["admin-signup-codes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "생성 실패");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          가입 코드{" "}
          <span className="text-sm font-normal text-muted-foreground">
            미사용 {data?.unused ?? "—"} · 사용 {data?.used ?? "—"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            type="number"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-24"
          />
          <Button onClick={generate}>묶음 생성</Button>
        </div>
        {newCodes.length > 0 && (
          <textarea
            readOnly
            className="h-32 w-full rounded-lg border bg-muted/40 p-2 font-mono text-xs"
            value={newCodes.join("\n")}
          />
        )}
      </CardContent>
    </Card>
  );
}

function VisitCodeSection() {
  const { data } = useQuery({
    queryKey: ["admin-visit-codes"],
    queryFn: () => getJson<{ codes: Array<{ date: string; code: string }> }>("/api/admin/visit-codes"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">방문 보너스 코드 (14일)</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-1 font-mono text-sm">
        {data?.codes.map((v) => (
          <p key={v.date}>
            <span className="text-muted-foreground">{v.date.slice(5)}</span> {v.code}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function EventSection() {
  const { data: quotes } = useQuotes();
  const queryClient = useQueryClient();
  const [stock, setStock] = useState("OKJA");
  const [bias, setBias] = useState("-30");

  async function circuitBreaker(minutes: number | null) {
    try {
      await postJson("/api/admin/circuit-breaker", { minutes });
      toast.success(minutes ? `서킷브레이커 ${minutes}분 발동` : "서킷브레이커 해제");
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    }
  }

  async function surprise() {
    try {
      const result = await postJson<{ fromTick: number; replaced: number }>(
        "/api/admin/surprise",
        { stockCode: stock, bias: Number(bias) }
      );
      toast.success(`${stock} 경로 재생성 (틱 ${result.fromTick} 이후 ${result.replaced}개)`);
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      queryClient.invalidateQueries({ queryKey: ["chart", stock] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">시장 이벤트</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button variant="destructive" onClick={() => circuitBreaker(10)}>
            ⚡ 서킷브레이커 10분
          </Button>
          <Button variant="outline" onClick={() => circuitBreaker(null)}>
            해제
          </Button>
        </div>
        <div className="flex gap-2">
          <select
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            className="rounded-lg border bg-background px-2 text-sm"
          >
            {quotes?.quotes.map((q) => (
              <option key={q.code} value={q.code}>
                {q.name}
              </option>
            ))}
          </select>
          <Input
            type="number"
            value={bias}
            onChange={(e) => setBias(e.target.value)}
            className="w-20"
            placeholder="편향"
          />
          <Button onClick={surprise}>💥 깜짝 이벤트</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          깜짝 이벤트는 남은 오늘 경로를 지정 편향으로 다시 뽑습니다 (장중에만 가능)
        </p>
      </CardContent>
    </Card>
  );
}

function ManualNewsSection() {
  const { data: quotes } = useQuotes();
  const [stock, setStock] = useState<string>("");
  const [grade, setGrade] = useState<"news" | "rumor" | "disclosure">("news");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  async function publish() {
    try {
      await postJson("/api/admin/news", {
        stockCode: stock || null,
        grade,
        title,
        body,
      });
      toast.success("뉴스 발행 완료");
      setTitle("");
      setBody("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "발행 실패");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">수동 뉴스 발행</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-2">
          <select
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            className="rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">시장 전체</option>
            {quotes?.quotes.map((q) => (
              <option key={q.code} value={q.code}>
                {q.name}
              </option>
            ))}
          </select>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value as typeof grade)}
            className="rounded-lg border bg-background px-2 text-sm"
          >
            <option value="news">📢 뉴스</option>
            <option value="rumor">💬 찌라시</option>
            <option value="disclosure">📰 공시</option>
          </select>
        </div>
        <Input placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          placeholder="본문"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="h-20 w-full rounded-lg border bg-background p-2 text-sm"
        />
        <Button onClick={publish} disabled={!title.trim() || !body.trim()}>
          발행
        </Button>
      </CardContent>
    </Card>
  );
}

function UserSection() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["admin-users", search],
    queryFn: () =>
      getJson<{
        users: Array<{
          id: number;
          nickname: string;
          cash: number;
          isBanned: boolean;
        }>;
      }>(`/api/admin/users?q=${encodeURIComponent(search)}`),
  });

  async function toggleBan(userId: number, banned: boolean) {
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, banned }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success(banned ? "계정 정지" : "정지 해제");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">유저 관리</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            placeholder="닉네임 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSearch(query)}
          />
          <Button variant="outline" onClick={() => setSearch(query)}>
            검색
          </Button>
        </div>
        <div className="flex flex-col divide-y divide-border/60">
          {data?.users.map((u) => (
            <div key={u.id} className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">
                  {u.nickname}{" "}
                  {u.isBanned && (
                    <Badge variant="destructive" className="px-1.5 text-[11px]">
                      정지
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">현금 {formatMoney(u.cash)}</p>
              </div>
              <Button
                size="sm"
                variant={u.isBanned ? "outline" : "destructive"}
                onClick={() => toggleBan(u.id, !u.isBanned)}
              >
                {u.isBanned ? "해제" : "정지"}
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

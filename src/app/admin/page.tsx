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
      <SignupCodeSection />
      <VisitCodeSection />
      <EventSection />
      <ManualNewsSection />
      <UserSection />
    </div>
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

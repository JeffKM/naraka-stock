"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";

interface AdminUser {
  id: number;
  nickname: string;
  cash: number;
  isAdmin: boolean;
  isBanned: boolean;
}

export function UserSection() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["admin-users", search],
    queryFn: () =>
      getJson<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(search)}`),
  });

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
            <UserRow
              key={u.id}
              user={u}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["admin-users"] })}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function UserRow({ user, onChanged }: { user: AdminUser; onChanged: () => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggleBan(banned: boolean) {
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, banned }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success(banned ? "계정 정지" : "정지 해제");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    }
  }

  // sign: +1 지급, -1 회수. amount 입력은 절대값이고 버튼이 부호를 정한다.
  async function adjustCash(sign: 1 | -1) {
    const magnitude = Math.floor(Number(amount));
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
      toast.error("조정할 금액을 입력해주세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: sign * magnitude }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success(
        `${user.nickname} ${sign > 0 ? "지급" : "회수"} ${formatMoney(magnitude)} · 잔고 ${formatMoney(json.data.cash)}`
      );
      setAmount("");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">
            {user.nickname}{" "}
            {user.isAdmin && (
              <Badge variant="secondary" className="px-1.5 text-[11px]">
                어드민
              </Badge>
            )}
            {user.isBanned && (
              <Badge variant="destructive" className="px-1.5 text-[11px]">
                정지
              </Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground">현금 {formatMoney(user.cash)}</p>
        </div>
        {/* 어드민 계정은 정지 대상이 아님 (서버에서도 차단) */}
        {!user.isAdmin && (
          <Button
            size="sm"
            variant={user.isBanned ? "outline" : "destructive"}
            onClick={() => toggleBan(!user.isBanned)}
          >
            {user.isBanned ? "해제" : "정지"}
          </Button>
        )}
      </div>
      {/* 현금 지급/회수 — 어드민 계정은 대상 아님 (서버에서도 차단) */}
      {!user.isAdmin && (
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="금액(원)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8"
          />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => adjustCash(1)}>
            지급
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => adjustCash(-1)}>
            회수
          </Button>
        </div>
      )}
    </div>
  );
}

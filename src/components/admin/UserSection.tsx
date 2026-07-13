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

export function UserSection() {
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

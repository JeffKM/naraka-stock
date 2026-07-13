"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getJson } from "@/lib/api/client";
import { formatMoney } from "@/lib/market";

export function DashboardSection() {
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

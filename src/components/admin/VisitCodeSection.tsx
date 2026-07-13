"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getJson } from "@/lib/api/client";

export function VisitCodeSection() {
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

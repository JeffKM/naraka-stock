"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getJson } from "@/lib/api/client";
import type { AdminSignupRequest } from "@/types/domain";

export function SignupRequestSection() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-signup-requests"],
    queryFn: () =>
      getJson<{ requests: AdminSignupRequest[] }>("/api/admin/signup-requests"),
    refetchInterval: 30_000,
  });

  async function decide(requestId: number, action: "approve" | "reject") {
    try {
      const res = await fetch("/api/admin/signup-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success(action === "approve" ? "가입 승인" : "요청 거절");
      // 승인 시 유저 목록에도 새 계정이 반영되므로 함께 갱신
      queryClient.invalidateQueries({ queryKey: ["admin-signup-requests"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    }
  }

  const requests = data?.requests ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">가입 요청 ({requests.length})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            대기 중인 가입 요청이 없습니다.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border/60">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{r.nickname}</p>
                  <p className="text-xs text-muted-foreground">코드 {r.code}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(r.id, "approve")}>
                    승인
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => decide(r.id, "reject")}
                  >
                    거절
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

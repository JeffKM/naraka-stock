"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson, postJson } from "@/lib/api/client";

export function SignupCodeSection() {
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

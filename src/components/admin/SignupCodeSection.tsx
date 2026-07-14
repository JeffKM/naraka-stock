"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteJson, getJson, postJson } from "@/lib/api/client";

interface SignupCodesData {
  unused: number;
  used: number;
  unusedCodes: string[];
  adminUnused: number;
  adminUnusedCodes: string[];
}

export function SignupCodeSection() {
  const queryClient = useQueryClient();
  const [count, setCount] = useState("20");
  const [adminCount, setAdminCount] = useState("1");
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [newAdminCodes, setNewAdminCodes] = useState<string[]>([]);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin-signup-codes"],
    queryFn: () => getJson<SignupCodesData>("/api/admin/signup-codes"),
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

  async function generateAdmin() {
    try {
      const { codes } = await postJson<{ codes: string[] }>("/api/admin/signup-codes", {
        count: Number(adminCount),
        isAdmin: true,
      });
      setNewAdminCodes(codes);
      toast.success(`어드민 코드 ${codes.length}개 생성 완료`);
      queryClient.invalidateQueries({ queryKey: ["admin-signup-codes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "생성 실패");
    }
  }

  async function discardUnused() {
    // 첫 클릭은 확인 대기, 두 번째 클릭에 실제 삭제
    if (!confirmingDiscard) {
      setConfirmingDiscard(true);
      setTimeout(() => setConfirmingDiscard(false), 4000);
      return;
    }
    setConfirmingDiscard(false);
    try {
      const { deleted } = await deleteJson<{ deleted: number }>(
        "/api/admin/signup-codes",
      );
      setNewCodes([]);
      toast.success(`미사용 코드 ${deleted}개를 버렸습니다`);
      queryClient.invalidateQueries({ queryKey: ["admin-signup-codes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제 실패");
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
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">방금 생성된 코드</p>
            <textarea
              readOnly
              className="h-32 w-full rounded-lg border bg-muted/40 p-2 font-mono text-xs"
              value={newCodes.join("\n")}
            />
          </div>
        )}
        {data && data.unusedCodes.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                미사용 코드 전체 (오래된 순 — 위에서부터 사용)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(data.unusedCodes.join("\n"));
                    toast.success("미사용 코드를 복사했습니다");
                  }}
                >
                  전체 복사
                </Button>
                <Button
                  variant={confirmingDiscard ? "destructive" : "outline"}
                  size="sm"
                  onClick={discardUnused}
                >
                  {confirmingDiscard ? "정말 버릴까요?" : "전체 버리기"}
                </Button>
              </div>
            </div>
            <textarea
              readOnly
              className="h-48 w-full rounded-lg border bg-muted/40 p-2 font-mono text-xs"
              value={data.unusedCodes.join("\n")}
            />
          </div>
        )}

        {/* 어드민 코드: 사장님 계정 발급용 — 손님 코드와 반드시 구분해 관리한다 */}
        <div className="mt-1 flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            어드민 코드 (ADM-)
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              미사용 {data?.adminUnused ?? "—"}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            이 코드로 가입하면 곧바로 어드민 계정이 됩니다. 손님에게 절대 배포하지
            마세요.
          </p>
          <div className="flex gap-2">
            <Input
              type="number"
              value={adminCount}
              onChange={(e) => setAdminCount(e.target.value)}
              className="w-24"
            />
            <Button variant="outline" onClick={generateAdmin}>
              어드민 코드 생성
            </Button>
          </div>
          {newAdminCodes.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">방금 생성된 어드민 코드</p>
              <textarea
                readOnly
                className="h-20 w-full rounded-lg border bg-background/60 p-2 font-mono text-xs"
                value={newAdminCodes.join("\n")}
              />
            </div>
          )}
          {data && data.adminUnusedCodes.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">미사용 어드민 코드 전체</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(data.adminUnusedCodes.join("\n"));
                    toast.success("미사용 어드민 코드를 복사했습니다");
                  }}
                >
                  전체 복사
                </Button>
              </div>
              <textarea
                readOnly
                className="h-20 w-full rounded-lg border bg-background/60 p-2 font-mono text-xs"
                value={data.adminUnusedCodes.join("\n")}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

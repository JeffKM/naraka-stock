"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteJson, getJson, patchJson, postJson } from "@/lib/api/client";
import type { Sector } from "@/types/domain";

// 섹터 관리: 목록 조회 + 추가·라벨 변경·삭제
export function SectorSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-sectors"],
    queryFn: () => getJson<{ sectors: Sector[] }>("/api/admin/sectors"),
  });
  const sectors = data?.sectors ?? [];

  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-sectors"] });
    qc.invalidateQueries({ queryKey: ["admin-stocks"] });
  };

  const create = useMutation({
    mutationFn: () =>
      postJson("/api/admin/sectors", {
        code: newCode.trim(),
        labelKo: newLabel.trim(),
        sortOrder: (sectors.at(-1)?.sortOrder ?? 100) + 10,
      }),
    onSuccess: () => {
      setNewCode("");
      setNewLabel("");
      invalidate();
      toast.success("섹터를 추가했습니다");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: (v: { code: string; labelKo: string }) =>
      patchJson("/api/admin/sectors", v),
    onSuccess: () => {
      invalidate();
      toast.success("섹터 라벨을 변경했습니다");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (code: string) => deleteJson("/api/admin/sectors", { code }),
    onSuccess: () => {
      invalidate();
      toast.success("섹터를 삭제했습니다");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">섹터 관리</h2>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">코드(slug)</label>
          <Input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="예: energy"
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">라벨</label>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="예: 에너지·원자력"
            className="w-48"
          />
        </div>
        <Button
          onClick={() => create.mutate()}
          disabled={!newCode.trim() || !newLabel.trim() || create.isPending}
        >
          <Plus className="mr-1 size-4" />
          추가
        </Button>
      </div>

      <ul className="divide-y rounded-md border">
        {sectors.map((s) => (
          <li key={s.code} className="flex items-center gap-3 px-3 py-2">
            <span className="w-32 font-mono text-xs text-muted-foreground">
              {s.code}
            </span>
            <Input
              defaultValue={s.labelKo}
              className="w-48"
              onBlur={(e) => {
                const labelKo = e.target.value.trim();
                if (labelKo && labelKo !== s.labelKo) {
                  rename.mutate({ code: s.code, labelKo });
                }
              }}
            />
            <span className="text-xs text-muted-foreground">정렬 {s.sortOrder}</span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              onClick={() => {
                if (confirm(`섹터 "${s.labelKo}" 삭제? (종목이 배치돼 있으면 실패)`)) {
                  remove.mutate(s.code);
                }
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

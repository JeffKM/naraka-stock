"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteJson, getJson, patchJson, postJson } from "@/lib/api/client";

interface AdminSticker {
  id: string;
  label: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
}

// 로컬 이미지 파일을 data URI 문자열로 읽는다.
function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

export function StickerSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-stickers"],
    queryFn: () => getJson<{ stickers: AdminSticker[] }>("/api/admin/stickers"),
  });

  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [dataUri, setDataUri] = useState("");
  const [saving, setSaving] = useState(false);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-stickers"] });
    queryClient.invalidateQueries({ queryKey: ["stickers"] }); // 공개 카탈로그도 갱신
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    try {
      setDataUri(await fileToDataUri(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "파일 읽기 실패");
    }
  }

  async function add() {
    if (!id.trim() || !label.trim() || !dataUri || saving) return;
    setSaving(true);
    try {
      await postJson("/api/admin/stickers", {
        id: id.trim(),
        label: label.trim(),
        imageDataUri: dataUri,
      });
      setId("");
      setLabel("");
      setDataUri("");
      invalidate();
      toast.success("스티커를 추가했어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "추가 실패");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: AdminSticker) {
    try {
      await patchJson("/api/admin/stickers", { id: s.id, isActive: !s.isActive });
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "변경 실패");
    }
  }

  async function remove(s: AdminSticker) {
    if (!window.confirm(`'${s.label}' 스티커를 삭제할까요?`)) return;
    try {
      await deleteJson(`/api/admin/stickers?id=${encodeURIComponent(s.id)}`);
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제 실패");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">스티커 관리</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
          <div className="flex gap-2">
            <Input placeholder="id (영소문자·숫자·하이픈)" value={id} onChange={(e) => setId(e.target.value)} />
            <Input placeholder="라벨" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => onPickFile(e.target.files?.[0])}
            className="text-sm"
          />
          {dataUri && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUri} alt="미리보기" className="size-20 object-contain" />
          )}
          <Button onClick={add} disabled={saving || !id.trim() || !label.trim() || !dataUri}>
            추가
          </Button>
          <p className="text-xs text-muted-foreground">이미지는 100KB 이하 png/jpeg/webp/svg</p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {data?.stickers.map((s) => (
            <div
              key={s.id}
              className={`flex flex-col items-center gap-1 rounded-md border p-2 ${
                s.isActive ? "border-border/60" : "border-border/30 opacity-50"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.imageUrl} alt={s.label} className="size-16 object-contain" />
              <span className="text-xs">{s.label}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => toggleActive(s)}>
                  {s.isActive ? "숨김" : "노출"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => remove(s)}>
                  삭제
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

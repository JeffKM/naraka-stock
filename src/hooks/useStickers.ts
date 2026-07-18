"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getJson } from "@/lib/api/client";

export interface CatalogSticker {
  id: string;
  label: string;
  imageUrl: string;
}

// 공개 스티커 카탈로그를 1회 로드해 캐시한다. 댓글의 sticker_id를 이미지로 매핑할 때 쓴다.
export function useStickers() {
  const { data } = useQuery({
    queryKey: ["stickers"],
    queryFn: () => getJson<{ stickers: CatalogSticker[] }>("/api/stickers"),
    staleTime: 5 * 60_000,
  });
  const stickers = useMemo(() => data?.stickers ?? [], [data]);
  const byId = useMemo(() => new Map(stickers.map((s) => [s.id, s])), [stickers]);
  return { stickers, byId };
}

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchJson } from "@/lib/api/client";

// 대표 배지 설정 mutation. badgeId=null이면 해제(현재 UI에선 미사용, API 계약상 지원).
export function useSetRepresentativeBadge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (badgeId: string | null) =>
      patchJson<{ representativeBadgeId: string | null }>(
        "/api/weekly-badges/representative",
        { badgeId },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ranking"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-badges", "me"] });
    },
  });
}

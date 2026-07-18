"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api/client";
import type { UserWeeklyBadge, WeeklyBadge } from "@/types/domain";

// 배지 카탈로그 12종 (거의 불변 → 길게 캐시)
export function useWeeklyBadgeCatalog() {
  const { data } = useQuery({
    queryKey: ["weekly-badges"],
    queryFn: () => getJson<{ badges: WeeklyBadge[] }>("/api/weekly-badges"),
    staleTime: 1000 * 60 * 60,
  });
  return data?.badges ?? [];
}

// 본인 이번 주 보유 배지 (비로그인이면 빈 배열)
export function useMyWeeklyBadges() {
  const { data, isError } = useQuery({
    queryKey: ["weekly-badges", "me"],
    queryFn: () =>
      getJson<{ weekStart: string; badges: UserWeeklyBadge[] }>("/api/weekly-badges/me"),
    retry: false,
  });
  return {
    weekStart: data?.weekStart ?? null,
    owned: new Set((data?.badges ?? []).map((b) => b.id)),
    badges: data?.badges ?? [],
    loggedOut: isError,
  };
}

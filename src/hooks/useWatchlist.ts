"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, postJson } from "@/lib/api/client";

// 관심종목 조회 + 낙관적 토글. 비로그인이면 GET 실패 → codes 빈 셋(재시도 없음).
export function useWatchlist() {
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => getJson<{ codes: string[] }>("/api/watchlist"),
    retry: false,
  });
  const codes = new Set(data?.codes ?? []);

  const mutation = useMutation({
    mutationFn: (code: string) =>
      postJson<{ watching: boolean }>("/api/watchlist", { stockCode: code }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  return {
    codes,
    // 비로그인이면 GET이 401로 실패 — 탭 안내에 로그인 유도를 다르게 보여주기 위해 노출
    loggedOut: isError,
    isWatching: (code: string) => codes.has(code),
    toggle: (code: string) => mutation.mutate(code),
  };
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api/client";
import type { LimitOrder } from "@/types/domain";

export interface MyOrders {
  pending: LimitOrder[];
  history: LimitOrder[];
}

// 내 지정가 예약주문 (미체결 + 최근 내역). 조회 시 서버가 lazy 소급 정산하므로
// 폴링만으로도 체결이 반영된다. 비로그인이면 실패 → 카드 자체를 숨긴다.
export function useMyOrders() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: () => getJson<MyOrders>("/api/orders"),
    refetchInterval: 60_000,
    retry: false,
  });
}

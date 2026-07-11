"use client";

import { useIsFetching, useIsMutating } from "@tanstack/react-query";

// 데이터 요청 중임을 알리는 상단 미세 프로그레스 바.
// 어떤 쿼리든 진행 중이면 헤더 아래에 흐르는 붉은 선이 보인다.
export function FetchIndicator() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  if (fetching + mutating === 0) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden" aria-hidden>
      <div className="h-full w-1/3 animate-fetch-slide rounded-full bg-primary" />
    </div>
  );
}

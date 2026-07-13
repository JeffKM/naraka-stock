"use client";

import { useHoldingAlerts } from "@/hooks/useHoldingAlerts";

// 어느 페이지에 있든 보유 종목 변동 알림이 동작하도록 레이아웃에 상주하는 워처
export function HoldingAlertWatcher() {
  useHoldingAlerts();
  return null;
}

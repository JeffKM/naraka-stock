"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// 사용자 설정 (설정 모달) — localStorage에 유지되는 클라이언트 전용 상태.
// 색상 모드는 next-themes가 자체 관리하므로 여기에 두지 않는다.
interface SettingsState {
  volume: number; // 효과음 볼륨 (0~100)
  alertsEnabled: boolean; // 보유 종목 10% 단위 변동 알림
  setVolume: (volume: number) => void;
  setAlertsEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      volume: 70,
      alertsEnabled: true,
      setVolume: (volume) => set({ volume: Math.min(100, Math.max(0, volume)) }),
      setAlertsEnabled: (alertsEnabled) => set({ alertsEnabled }),
    }),
    { name: "naraka-settings" }
  )
);

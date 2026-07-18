import type { WeeklyBadge } from "@/types/domain";

// 닉네임 옆 대표 배지 1개(작은 칩). 이모지 금지 — 심볼/텍스트.
export function BadgeChip({ badge }: { badge: WeeklyBadge }) {
  return (
    <span
      title={`${badge.name} · ${badge.description}`}
      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary align-middle"
    >
      <span aria-hidden className="font-bold">
        {badge.iconUrl || badge.name.slice(0, 1)}
      </span>
      {badge.name}
    </span>
  );
}

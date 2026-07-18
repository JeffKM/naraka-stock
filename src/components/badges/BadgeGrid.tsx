"use client";

import { useMyWeeklyBadges, useWeeklyBadgeCatalog } from "@/hooks/useWeeklyBadges";

// 12종 그리드: 이번 주 보유는 강조, 미보유는 회색 잠금 + 조건 툴팁.
export function BadgeGrid() {
  const catalog = useWeeklyBadgeCatalog();
  const { owned } = useMyWeeklyBadges();

  if (catalog.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">주간 시그니처 배지</h2>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {catalog.map((badge) => {
          const has = owned.has(badge.id);
          return (
            <div
              key={badge.id}
              title={`${badge.description}${badge.tieBreakNote ? ` · ${badge.tieBreakNote}` : ""}`}
              className={
                "flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition " +
                (has
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-muted/30 opacity-50 grayscale")
              }
            >
              <span
                aria-hidden
                className={
                  "flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold " +
                  (has ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
                }
              >
                {badge.iconUrl || badge.name.slice(0, 1)}
              </span>
              <span className="text-xs font-medium leading-tight">{badge.name}</span>
              {!has && <span className="text-[10px] text-muted-foreground">미획득</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

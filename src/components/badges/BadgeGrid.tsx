"use client";

import { useMyWeeklyBadges, useWeeklyBadgeCatalog } from "@/hooks/useWeeklyBadges";
import { useSetRepresentativeBadge } from "@/hooks/useRepresentativeBadge";

// 12종 그리드: 이번 주 보유는 강조, 미보유는 회색 잠금 + 조건 툴팁.
// 보유 배지는 버튼으로 노출해 클릭 시 대표 배지로 설정한다.
export function BadgeGrid() {
  const catalog = useWeeklyBadgeCatalog();
  const { owned } = useMyWeeklyBadges();
  const setRepresentative = useSetRepresentativeBadge();

  if (catalog.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">주간 시그니처 배지</h2>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {catalog.map((badge) => {
          const has = owned.has(badge.id);
          const title = `${badge.description}${badge.tieBreakNote ? ` · ${badge.tieBreakNote}` : ""}`;
          const cardClassName =
            "flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition " +
            (has
              ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
              : "border-border bg-muted/30 opacity-50 grayscale");
          const icon = (
            <span
              aria-hidden
              className={
                "flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold " +
                (has ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
              }
            >
              {badge.iconUrl || badge.name.slice(0, 1)}
            </span>
          );

          if (has) {
            return (
              <button
                key={badge.id}
                type="button"
                title={`${title} · 클릭해서 대표 배지로 설정`}
                aria-label={`${badge.name} 대표 배지로 설정`}
                disabled={setRepresentative.isPending}
                onClick={() => setRepresentative.mutate(badge.id)}
                className={cardClassName}
              >
                {icon}
                <span className="text-xs font-medium leading-tight">{badge.name}</span>
              </button>
            );
          }

          return (
            <div key={badge.id} title={title} className={cardClassName}>
              {icon}
              <span className="text-xs font-medium leading-tight">{badge.name}</span>
              <span className="text-[10px] text-muted-foreground">미획득</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

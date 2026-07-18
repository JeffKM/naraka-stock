import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Mascot, type MascotPose } from "./Mascot";

// 빈 상태 공용 컴포넌트 — 보밤이 + 한 줄 안내 + (선택) 행동.
// "왜 비었는지 + 다음에 뭘 할지"를 세계관 말투로 안내한다(이모지 없음).
export function EmptyState({
  pose = "idle",
  mascotSize = 88,
  title,
  description,
  action,
  className,
}: {
  pose?: MascotPose;
  mascotSize?: number;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-4 py-8 text-center",
        className,
      )}
    >
      <Mascot pose={pose} size={mascotSize} />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

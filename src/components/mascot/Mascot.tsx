import Image from "next/image";
import { cn } from "@/lib/utils";

// 나라카 마스코트 "보밤이" — 보라밤의 잔불에서 깨어난 복슬한 잔불 요괴.
// 장식 레이어 전용(데이터 카드 위 겹침 금지). 중간톤 자두색이라 다크/라이트 양쪽에서 실루엣이 살아남는다.
// 포즈 3종: idle(기본·빈 상태) / cheer(만세·거래완료 축하) / wave(손 흔들기·환영·보너스).

const POSES = {
  idle: { src: "/mascot/bobam-idle.png", w: 395, h: 448 },
  cheer: { src: "/mascot/bobam-cheer.png", w: 448, h: 431 },
  wave: { src: "/mascot/bobam-wave.png", w: 448, h: 440 },
} as const;

export type MascotPose = keyof typeof POSES;

export function Mascot({
  pose = "idle",
  size = 96,
  className,
}: {
  pose?: MascotPose;
  /** 정사각 프레임 한 변(px) — 이미지는 object-contain으로 중앙 정렬 */
  size?: number;
  className?: string;
}) {
  const p = POSES[pose];
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 select-none", className)}
      style={{ width: size, height: size }}
    >
      <Image
        src={p.src}
        alt=""
        aria-hidden
        width={p.w}
        height={p.h}
        className="h-full w-full object-contain"
        draggable={false}
      />
    </span>
  );
}

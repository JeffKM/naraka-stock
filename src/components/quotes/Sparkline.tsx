// 당일 가격 흐름 미니 스파크라인 (시세판 행용, 순수 SVG)

interface SparklineProps {
  points: number[];
  positive: boolean; // 등락 방향 (색상)
  neutral?: boolean;
}

const WIDTH = 64;
const HEIGHT = 28;
const PAD = 2;

export function Sparkline({ points, positive, neutral = false }: SparklineProps) {
  if (points.length < 2) {
    return <div style={{ width: WIDTH, height: HEIGHT }} aria-hidden />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points
    .map((p, i) => {
      const x = PAD + (i / (points.length - 1)) * (WIDTH - PAD * 2);
      const y = PAD + (1 - (p - min) / range) * (HEIGHT - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const color = neutral
    ? "var(--muted-foreground)"
    : positive
      ? "var(--bull)"
      : "var(--bear)";

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden
      className="shrink-0 opacity-80"
    >
      <polyline
        points={coords}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

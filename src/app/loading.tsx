import Image from "next/image";

// 라우트 전환 중 즉시 표시되는 로딩 화면 (App Router loading 컨벤션)
export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24">
      <Image
        src="/logo.png"
        alt="나라카증권"
        width={142}
        height={60}
        priority
        className="animate-pulse"
      />
      <p className="text-sm text-muted-foreground">불러오는 중...</p>
    </div>
  );
}

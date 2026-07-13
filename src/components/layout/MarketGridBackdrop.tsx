// 글로벌 증시 그리드 배경 — "진짜 거래소 시스템에 접속했다"는 무드 연출.
// 희미한 모눈 격자 위로 시세·지수·비트 텍스트 잔상이 은은하게 흘러간다.
// 순수 장식(aria-hidden)이며 값은 전부 고정 데이터 — 실제 시세와 무관한 눈속임 레이어.
// 위치·타이밍이 결정적(deterministic)이라 서버 컴포넌트로 렌더해도 hydration이 안전하다.

type DriftTone = "neutral" | "bull" | "bear";

interface DriftItem {
  text: string;
  tone: DriftTone;
  top: string; // 배경 내 절대 위치 (%)
  left: string;
  duration: number; // 초 — 서로 다르게 줘 사이클이 겹치지 않게 한다
  delay: number; // 음수 delay로 첫 화면부터 어긋난 상태로 시작
}

// 실제 상장 8종목 + 지수(NASPI/NASDAK) 코드를 그대로 사용해 세계관을 유지한다.
const DRIFT_ITEMS: DriftItem[] = [
  { text: "OKJA ▲30.0%", tone: "bull", top: "8%", left: "6%", duration: 13, delay: -2 },
  { text: "NASPI 1,042.55", tone: "neutral", top: "14%", left: "62%", duration: 17, delay: -9 },
  { text: "01101001", tone: "neutral", top: "24%", left: "18%", duration: 11, delay: -5 },
  { text: "NRKB ▼18.2%", tone: "bear", top: "31%", left: "74%", duration: 15, delay: -12 },
  { text: "MIHO ▲7.7%", tone: "bull", top: "42%", left: "8%", duration: 14, delay: -7 },
  { text: "VOL 128,400", tone: "neutral", top: "47%", left: "58%", duration: 12, delay: -3 },
  { text: "NASDAK 987.10", tone: "neutral", top: "57%", left: "12%", duration: 16, delay: -10 },
  { text: "BNZN ▼2.4%", tone: "bear", top: "63%", left: "70%", duration: 13, delay: -6 },
  { text: "1010 0011", tone: "neutral", top: "72%", left: "34%", duration: 11, delay: -1 },
  { text: "NRKE 52,300", tone: "neutral", top: "78%", left: "64%", duration: 15, delay: -8 },
  { text: "MERU ▲4.1%", tone: "bull", top: "85%", left: "10%", duration: 14, delay: -11 },
  { text: "NRKS ▲0.9%", tone: "bull", top: "90%", left: "48%", duration: 12, delay: -4 },
];

const TONE_CLASS: Record<DriftTone, string> = {
  neutral: "market-drift-neutral",
  bull: "market-drift-bull",
  bear: "market-drift-bear",
};

export function MarketGridBackdrop() {
  return (
    <div
      aria-hidden
      className="market-grid-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {DRIFT_ITEMS.map((item) => (
        <span
          key={item.text}
          className={`market-drift ${TONE_CLASS[item.tone]} absolute font-mono text-[10px] tracking-widest`}
          style={{
            top: item.top,
            left: item.left,
            "--drift-duration": `${item.duration}s`,
            "--drift-delay": `${item.delay}s`,
          } as React.CSSProperties}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

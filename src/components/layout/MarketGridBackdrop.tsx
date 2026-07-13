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

// 실제 상장 종목(27종 개편 로스터) + 지수(NASPI/NASDAK) 코드를 그대로 사용해 세계관을 유지한다.
// 종목 슬롯 15개는 전부 서로 다른 코드로 우량·일반·테마 세 등급을 고루 노출하고,
// 가격 표기는 2026-07-31 기준가 부근 값을 쓴다. 위치·duration·delay·톤 배분은
// 기존 튜닝(잔상 24개, 농도)을 그대로 유지 — 조합이 전부 달라 페이즈가 겹치지 않는다.
const DRIFT_ITEMS: DriftItem[] = [
  { text: "SPCO ▲30.0%", tone: "bull", top: "5%", left: "6%", duration: 13, delay: -2 },
  { text: "NASPI 1,042.55", tone: "neutral", top: "9%", left: "60%", duration: 17, delay: -9 },
  { text: "NRKM ▼5.6%", tone: "bear", top: "14%", left: "30%", duration: 12, delay: -6 },
  { text: "01101001", tone: "neutral", top: "19%", left: "8%", duration: 11, delay: -5 },
  { text: "NRKB ▼18.2%", tone: "bear", top: "23%", left: "72%", duration: 15, delay: -12 },
  { text: "OKHX 199,500", tone: "neutral", top: "28%", left: "44%", duration: 14, delay: -1 },
  { text: "MHEN ▲7.7%", tone: "bull", top: "33%", left: "10%", duration: 14, delay: -7 },
  { text: "MAPL 171,000", tone: "neutral", top: "37%", left: "66%", duration: 13, delay: -10 },
  { text: "VOL 128,400", tone: "neutral", top: "42%", left: "36%", duration: 12, delay: -3 },
  { text: "OKCC ▲29.4%", tone: "bull", top: "46%", left: "78%", duration: 16, delay: -14 },
  { text: "NASDAK 987.10", tone: "neutral", top: "51%", left: "6%", duration: 16, delay: -11 },
  { text: "1101 0110", tone: "neutral", top: "55%", left: "52%", duration: 11, delay: -8 },
  { text: "BNZN ▼2.4%", tone: "bear", top: "60%", left: "26%", duration: 13, delay: -6 },
  { text: "MLVD 246,500", tone: "neutral", top: "64%", left: "70%", duration: 15, delay: -2 },
  { text: "1010 0011", tone: "neutral", top: "69%", left: "12%", duration: 11, delay: -1 },
  { text: "MRSF ▲4.1%", tone: "bull", top: "73%", left: "56%", duration: 14, delay: -9 },
  { text: "NRKE 128,500", tone: "neutral", top: "77%", left: "34%", duration: 15, delay: -13 },
  { text: "MELL ▼17.8%", tone: "bear", top: "81%", left: "74%", duration: 12, delay: -4 },
  { text: "MIPA 54,350", tone: "neutral", top: "85%", left: "8%", duration: 13, delay: -11 },
  { text: "NASPI ▼6.8%", tone: "bear", top: "88%", left: "48%", duration: 17, delay: -5 },
  { text: "BNSK ▲0.9%", tone: "bull", top: "92%", left: "22%", duration: 12, delay: -3 },
  { text: "00101110", tone: "neutral", top: "95%", left: "64%", duration: 11, delay: -7 },
  { text: "NASDAK ▲18.9%", tone: "bull", top: "3%", left: "36%", duration: 15, delay: -10 },
  { text: "OKSL 118,900", tone: "neutral", top: "12%", left: "84%", duration: 14, delay: -4 },
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

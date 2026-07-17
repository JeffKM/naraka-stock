// 도메인 타입 — DB 스키마(PRD §9.2)와 1:1 대응하는 기본 타입과 화면용 파생 타입.

export type StockTier = "stable" | "normal" | "wild";
// 섹터는 이제 sectors 테이블의 동적 데이터다(어드민 관리). 코드는 소문자 slug.
export type StockSector = string;

export interface Sector {
  code: string;
  labelKo: string;
  sortOrder: number;
}

export type NewsGrade = "disclosure" | "news" | "rumor";
export type TradeSide = "buy" | "sell";

// 장 상태: open 개장 / closed 장외(개장일의 장 시간 외) / holiday 휴장일 / halted 서킷브레이커
export type MarketState = "open" | "closed" | "holiday" | "halted";

export interface Stock {
  code: string;
  name: string;
  tier: StockTier;
  sector: StockSector;
  description: string;
  listed: boolean;
  sharesOutstanding: number; // 발행주식수 (시가총액 = 현재가 × 발행주식수)
}

// 시세판·종목 상세에서 쓰는 현재가 스냅샷
export interface StockQuote {
  code: string;
  name: string;
  tier: StockTier;
  sector: StockSector;
  sectorLabel: string; // 섹터 한국어 라벨 (sectors 테이블에서 주입)
  price: number; // 현재 틱 가격 (원)
  prevClose: number; // 직전 개장일 종가
  change: number; // 등락액
  changePercent: number; // 등락률 (%)
  isHalted: boolean; // VI 거래정지 중
  isUpperLimit: boolean; // 상한가 도달
  isLowerLimit: boolean; // 하한가 도달
  upperLimit: number; // 오늘 상한가 (직전 종가 +30%)
  lowerLimit: number; // 오늘 하한가 (직전 종가 -30%)
  marketCap: number; // 시가총액 (현재가 × 발행주식수)
  volume: number; // 당일 누적 시뮬 시장 거래량 (사전 생성 틱 합)
  spark: number[]; // 오늘 개장~현재 틱의 가격 경로 (스파크라인용, 장외엔 빈 배열)
}

// 시장 지수 스냅샷 (나스피/나스닥 — 시총가중 체인, 기준 1,000pt)
export interface IndexQuote {
  code: string; // NASPI | NASDAK
  name: string; // 나스피 | 나스닥
  value: number; // 현재 지수 (소수 2자리)
  change: number; // 전 개장일 종가 지수 대비 등락
  changePercent: number;
  spark: number[]; // 오늘 개장~현재 틱의 지수 경로
}

export interface Holding {
  stockCode: string;
  stockName: string;
  quantity: number;
  avgPrice: number; // 평균 단가 (원)
}

export interface Trade {
  id: number;
  stockCode: string;
  stockName: string;
  side: TradeSide;
  quantity: number;
  price: number; // 체결 단가 (원)
  fee: number; // 수수료 (원)
  createdAt: string; // ISO 문자열
}

export interface NewsItem {
  id: number;
  date: string; // 게임 날짜 (YYYY-MM-DD)
  stockCode: string | null; // null = 시장 전체 공지
  stockName: string | null;
  grade: NewsGrade;
  title: string;
  body: string;
  source: string | null; // 찌라시 출처(기자·매체명). 수동 찌라시·자동 섹터 찌라시가 사용, 공시·정식뉴스는 null
  publishedAt: string;
}

// 보유 종목 + 평가 정보 (/api/portfolio)
export interface PortfolioHolding {
  stockCode: string;
  stockName: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  value: number; // 평가액
  pnl: number; // 평가손익 (원)
  pnlPercent: number; // 수익률 (%)
  reservedQty: number; // 매도 지정가로 예약(락)된 수량
  availableQty: number; // 매도 가능 수량 (= quantity − reservedQty)
}

export interface Portfolio {
  cash: number;
  holdings: PortfolioHolding[];
  totalAssets: number; // 현금 + 평가액 합 (예약분 포함 — 실제 이동 없음)
  reservedCash: number; // 매수 지정가로 예약(락)된 현금 합
  availableCash: number; // 매수 가능 현금 (= cash − reservedCash)
}

// 지정가 예약주문 (PRD §4.5) — status: pending 대기 / filled 체결 / cancelled 취소 / expired 당일만료
export type OrderStatus = "pending" | "filled" | "cancelled" | "expired";

export interface LimitOrder {
  id: number;
  stockCode: string;
  stockName: string;
  side: TradeSide;
  limitPrice: number;
  reservedCash: number | null; // 매수 예약 금액
  reservedQty: number | null; // 매도 예약 수량
  status: OrderStatus;
  createdAt: string;
  filledAt: string | null; // 소급 체결 시각
  filledPrice: number | null;
  filledQty: number | null;
}

// 로그인 유저 정보 (/api/auth/me 응답)
export interface Me {
  id: number;
  nickname: string;
  cash: number;
  isAdmin: boolean;
}

// 랭킹 한 줄
export interface RankingEntry {
  rank: number;
  nickname: string;
  totalAssets: number; // 현금 + 보유주식 평가액 (원)
}

// 고객센터 게시글
export type SupportCategory = "bug" | "inquiry" | "suggestion";
// open 접수완료 / reviewing 검토중 / done 답변완료
export type SupportStatus = "open" | "reviewing" | "done";

export interface SupportPost {
  id: number;
  category: SupportCategory;
  content: string;
  status: SupportStatus;
  reply: string | null; // 운영자 답변
  repliedAt: string | null;
  createdAt: string;
}

// 운영자 콘솔용 (작성자 닉네임 포함)
export interface AdminSupportPost extends SupportPost {
  nickname: string;
}

// 손님 가입요청 (어드민 승인 대기) — 운영자 콘솔용
export interface AdminSignupRequest {
  id: number;
  nickname: string;
  code: string;
  createdAt: string;
}

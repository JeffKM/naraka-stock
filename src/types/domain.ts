// 도메인 타입 — DB 스키마(PRD §9.2)와 1:1 대응하는 기본 타입과 화면용 파생 타입.

export type StockTier = "stable" | "normal" | "wild";
export type NewsGrade = "disclosure" | "news" | "rumor";
export type TradeSide = "buy" | "sell";

// 장 상태: open 개장 / closed 장외(개장일의 장 시간 외) / holiday 휴장일 / halted 서킷브레이커
export type MarketState = "open" | "closed" | "holiday" | "halted";

export interface Stock {
  code: string;
  name: string;
  tier: StockTier;
  description: string;
  listed: boolean;
}

// 시세판·종목 상세에서 쓰는 현재가 스냅샷
export interface StockQuote {
  code: string;
  name: string;
  tier: StockTier;
  price: number; // 현재 틱 가격 (원)
  prevClose: number; // 직전 개장일 종가
  change: number; // 등락액
  changePercent: number; // 등락률 (%)
  isHalted: boolean; // VI 거래정지 중
  isUpperLimit: boolean; // 상한가 도달
  isLowerLimit: boolean; // 하한가 도달
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
  grade: NewsGrade;
  title: string;
  body: string;
  publishedAt: string;
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

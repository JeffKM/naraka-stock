// API 응답 공통 래퍼 — 모든 API route는 이 형식으로만 응답한다.

export type ApiErrorCode =
  | "UNAUTHORIZED" // 로그인 필요
  | "FORBIDDEN" // 권한 없음 (어드민 전용 등)
  | "NOT_FOUND"
  | "VALIDATION" // 입력값 검증 실패 (Zod)
  | "MARKET_CLOSED" // 장외 시간·휴장일 주문
  | "TRADING_HALTED" // VI·서킷브레이커 거래정지
  | "INSUFFICIENT_CASH" // 잔고 부족
  | "INSUFFICIENT_QUANTITY" // 보유 수량 부족
  | "BAND_OUT" // 지정가가 당일 상하한(±30%) 밖
  | "ORDER_LIMIT" // 미체결 지정가 주문 개수 상한 초과
  | "CODE_INVALID" // 가입·방문 코드 무효
  | "CODE_ALREADY_USED" // 코드 중복 사용
  | "NICKNAME_TAKEN" // 닉네임 중복
  | "BANNED" // 정지 계정
  | "INTERNAL"; // 서버 내부 오류

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

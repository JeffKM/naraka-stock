import { NextResponse } from "next/server";
import type { ApiErrorCode, ApiResponse } from "@/types/api";

// 에러 코드별 HTTP 상태 매핑
const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  MARKET_CLOSED: 409,
  TRADING_HALTED: 409,
  INSUFFICIENT_CASH: 409,
  INSUFFICIENT_QUANTITY: 409,
  BAND_OUT: 409,
  ORDER_LIMIT: 409,
  CODE_INVALID: 400,
  CODE_ALREADY_USED: 409,
  NICKNAME_TAKEN: 409,
  REQUEST_DUPLICATE: 409,
  REQUEST_INVALID: 409,
  ATTENDANCE_ALREADY_CLAIMED: 409,
  BANNED: 403,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function apiOk<T>(data: T): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data });
}

export function apiError(
  code: ApiErrorCode,
  message: string
): NextResponse<ApiResponse<never>> {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status: STATUS_BY_CODE[code] }
  );
}

// 도메인 로직에서 던지는 예외 — route 핸들러의 handleApiError가 응답으로 변환한다.
export class ApiException extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ApiException";
  }
}

// route 핸들러 공통 에러 처리:
//   try { ... } catch (e) { return handleApiError(e); }
export function handleApiError(error: unknown): NextResponse<ApiResponse<never>> {
  if (error instanceof ApiException) {
    return apiError(error.code, error.message);
  }
  console.error("[api] 처리되지 않은 오류:", error);
  return apiError("INTERNAL", "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
}

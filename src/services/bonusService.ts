import "server-only";
import { ApiException } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export interface BonusResult {
  cash: number; // 지급 후 현금 잔고
}

// 방문 보너스 수령 (T-104): 검증·1일 1회·지급을 DB 함수 단일 트랜잭션으로 처리
export async function claimVisitBonus(userId: number, code: string): Promise<BonusResult> {
  const supabase = getSupabaseAdmin();
  const { data: cash, error } = await supabase.rpc("claim_visit_bonus", {
    p_user_id: userId,
    p_code: code.trim(),
  });

  if (error) {
    if (error.message.includes("CODE_INVALID")) {
      throw new ApiException("CODE_INVALID", "오늘의 방문 코드가 아닙니다.");
    }
    if (error.message.includes("CODE_ALREADY_USED")) {
      throw new ApiException("CODE_ALREADY_USED", "오늘은 이미 방문 보너스를 받았습니다.");
    }
    throw error;
  }

  return { cash };
}

export interface AttendanceResult {
  cash: number; // 지급 후 현금 잔고
  streak: number; // 이번 수령의 연속일
  amount: number; // 이번 지급액
}

export interface AttendanceStatus {
  claimedToday: boolean;
  currentStreak: number;
  nextStreak: number;
  nextAmount: number;
}

// 출석 보너스 수령: 스트릭 계산·지급을 DB 함수 단일 트랜잭션으로 처리
export async function claimAttendanceBonus(userId: number): Promise<AttendanceResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("claim_attendance_bonus", {
    p_user_id: userId,
  });

  if (error) {
    if (error.message.includes("ATTENDANCE_ALREADY_CLAIMED")) {
      throw new ApiException(
        "ATTENDANCE_ALREADY_CLAIMED",
        "오늘은 이미 출석 보너스를 받았습니다."
      );
    }
    throw error;
  }

  return data as AttendanceResult;
}

// 출석 상태 조회 (UI 표시용)
export async function getAttendanceStatus(userId: number): Promise<AttendanceStatus> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("attendance_status", {
    p_user_id: userId,
  });
  if (error) throw error;
  return data as AttendanceStatus;
}

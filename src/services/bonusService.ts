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

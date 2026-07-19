import "server-only";
import { ApiException } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// 요청 속도 제한 (rate limit) — DB 기반. 설계 배경은 마이그레이션 참고.
//   supabase/migrations/20260720000000_rate_limit.sql
//
// Vercel 서버리스에선 인메모리 카운터가 인스턴스마다 갈려 신뢰할 수 없으므로,
// 원자적 Postgres 함수(check_rate_limit)로 판정한다.

// 프록시(Vercel) 뒤의 실제 클라이언트 IP. 헤더는 위조 가능하나, rate limit은
// 정상 트래픽의 우발적 과다를 걸러내는 1차 방어라 이 정도면 충분하다.
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // "client, proxy1, proxy2" — 맨 앞이 원 클라이언트
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

// 버킷 요청을 1건 기록하고, 한도를 넘었으면 RATE_LIMITED 예외를 던진다.
//   - limit: 윈도우당 허용 횟수
//   - windowSeconds: 윈도우 길이(초)
// DB 오류 시에는 fail-open(허용)한다 — 속도 제한기 장애가 정상 사용자를 막지 않도록.
export async function enforceRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
  message = "요청이 너무 잦습니다. 잠시 후 다시 시도해주세요."
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error("[rate-limit] check_rate_limit 실패(fail-open):", error.message);
    return;
  }
  if (data === false) {
    throw new ApiException("RATE_LIMITED", message);
  }
}

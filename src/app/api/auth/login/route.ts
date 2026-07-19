import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation/auth";
import { login } from "@/services/authService";

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }

    // 무차별 대입 방어: 계정(닉네임) 단위가 정밀 방어선(NAT 무관), IP는 자동 플러드만 차단.
    // 카페 공유 WiFi를 고려해 IP 한도는 넉넉히 둔다.
    const nickname = parsed.data.nickname.trim();
    await enforceRateLimit(
      `login:nick:${nickname}`,
      10,
      300,
      "로그인 시도가 많습니다. 잠시 후 다시 시도해주세요."
    );
    await enforceRateLimit(`login:ip:${getClientIp(request)}`, 60, 300);

    return apiOk(await login(parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}

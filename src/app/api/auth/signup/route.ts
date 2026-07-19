import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { signupSchema } from "@/lib/validation/auth";
import { signup } from "@/services/authService";

export async function POST(request: Request) {
  try {
    const parsed = signupSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }

    // 가입 스팸 방어: 로그인 전이라 IP 단위만 가능. 코드는 물리적으로 1장씩 배부돼
    // 정상 가입은 드문드문 발생하므로, 카페 공유 WiFi를 고려해도 이 한도면 넉넉하다.
    await enforceRateLimit(`signup:ip:${getClientIp(request)}`, 40, 600);

    return apiOk(await signup(parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}

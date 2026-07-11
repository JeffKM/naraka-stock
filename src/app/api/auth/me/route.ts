import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";

// 현재 로그인 유저 정보 (헤더·지갑 화면에서 사용)
export async function GET() {
  try {
    const user = await requireUser();
    return apiOk(user);
  } catch (error) {
    return handleApiError(error);
  }
}

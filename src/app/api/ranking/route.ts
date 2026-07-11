import { apiOk, handleApiError } from "@/lib/api/response";
import { getRanking } from "@/services/rankingService";

// 랭킹 (공개 — 로그인 시 내 순위 포함)
export async function GET() {
  try {
    return apiOk(await getRanking());
  } catch (error) {
    return handleApiError(error);
  }
}

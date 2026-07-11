import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { getTrades } from "@/services/portfolioService";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const pageParam = Number(new URL(request.url).searchParams.get("page") ?? "1");
    const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    return apiOk(await getTrades(user.id, page));
  } catch (error) {
    return handleApiError(error);
  }
}

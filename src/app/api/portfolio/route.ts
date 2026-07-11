import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { getPortfolio } from "@/services/portfolioService";

export async function GET() {
  try {
    const user = await requireUser();
    return apiOk(await getPortfolio(user.id));
  } catch (error) {
    return handleApiError(error);
  }
}

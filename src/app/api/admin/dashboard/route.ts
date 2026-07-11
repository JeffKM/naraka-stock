import { apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { getDashboard } from "@/services/adminService";

export async function GET() {
  try {
    await requireAdmin();
    return apiOk(await getDashboard());
  } catch (error) {
    return handleApiError(error);
  }
}

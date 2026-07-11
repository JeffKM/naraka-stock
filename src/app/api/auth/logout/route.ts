import { apiOk, handleApiError } from "@/lib/api/response";
import { destroySession } from "@/lib/auth/session";

export async function POST() {
  try {
    await destroySession();
    return apiOk({ loggedOut: true });
  } catch (error) {
    return handleApiError(error);
  }
}

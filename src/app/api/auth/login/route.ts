import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { loginSchema } from "@/lib/validation/auth";
import { login } from "@/services/authService";

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    return apiOk(await login(parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}

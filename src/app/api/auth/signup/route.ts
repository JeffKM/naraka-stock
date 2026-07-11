import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { signupSchema } from "@/lib/validation/auth";
import { signup } from "@/services/authService";

export async function POST(request: Request) {
  try {
    const parsed = signupSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    return apiOk(await signup(parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}

import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { runDailyBatch } from "@/services/batchService";

// 일일 배치 트리거 (폐장 시각 KST — pg_cron이 pg_net으로 호출, 폐장 시각 변경 시
// reschedule_daily_batch가 스케줄을 자동 재조정)
// 수동 실행: curl -X POST -H "Authorization: Bearer $CRON_SECRET" /api/cron/daily-batch
export async function POST(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get("authorization");
    if (!secret || auth !== `Bearer ${secret}`) {
      return apiError("FORBIDDEN", "잘못된 크론 시크릿입니다.");
    }

    // 테스트·리허설용 날짜 오버라이드 (?date=YYYY-MM-DD)
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    return apiOk(await runDailyBatch(date));
  } catch (error) {
    return handleApiError(error);
  }
}

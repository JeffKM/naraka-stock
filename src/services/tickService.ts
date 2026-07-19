import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { TICKS_PER_CANDLE } from "@/lib/market";

// 특정 날짜의 종목별 마지막 틱 = 그날 종가.
// 하루 틱 수가 장 시간에 따라 가변(84/144/...)이므로 "틱 83" 같은 고정
// 인덱스 대신 항상 마지막 틱을 조회한다 — 장 시간이 운영 중 바뀌어도 안전.
//
// Task 21: 10초 틱 전환(Task 4) 이후 daily_ticks 전량 조회(42종목 × 최대 4,320틱)는
// 배치에서 최대 3회(loadTodayMoves·loadPrevCloses·recordIndexCloses) 호출되어
// Vercel maxDuration을 갉아먹는다. 이 함수가 호출되는 date는 항상 "이미 마감된
// 날"이고, 그 날의 daily_candles는 전날 배치가 build_daily_candles로 이미
// 사전 집계해 둔 상태이므로(chartService와 동일 전제) daily_candles를 소스로
// 쓴다. 마지막 틱 가격 = 그 날 최대 bucket의 close(풀데이면 bucket 719 close
// = tick 4319 price와 동일값) — 6배 가벼운 30,240행(42종목 × 720버킷)만 읽는다.
export interface LastTick {
  tickIndex: number;
  price: number;
}

export async function loadDayLastTicks(date: string): Promise<Record<string, LastTick>> {
  const supabase = getSupabaseAdmin();
  // PostgREST max_rows(로컬 config.toml=1000) 상한 대응: 전 종목 × 전 버킷도
  // 1000행을 넘어(42종목 × 720버킷 = 30,240행) 단일 쿼리로는 잘린다. range로
  // 페이지네이션한다. (stock_code, bucket) 정렬이라 페이지 경계가 종목 중간에
  // 걸려도 다음 페이지에서 더 큰 bucket이 이어서 덮어써 최종값이 정확하다.
  // (chartService의 daily_candles 페이지네이션과 동일 패턴)
  const PAGE = 1000;
  const last: Record<string, LastTick> = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("daily_candles")
      .select("stock_code, bucket, close")
      .eq("date", date)
      .order("stock_code", { ascending: true })
      .order("bucket", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data) {
      // 호출부(loadTodayMoves·loadPrevCloses·recordIndexCloses)는 price만 읽고
      // tickIndex는 쓰지 않는다 — 인터페이스 호환을 위해 해당 버킷의 마지막
      // 틱 인덱스로 근사한다(풀데이면 정확히 그 종목의 실제 마지막 틱과 일치).
      last[row.stock_code] = {
        tickIndex: (row.bucket + 1) * TICKS_PER_CANDLE - 1,
        price: row.close,
      };
    }
    if (data.length < PAGE) break;
  }

  if (Object.keys(last).length === 0) {
    // daily_candles가 비었다 — "그 날 틱이 아예 없음"(정상: 이벤트 시작 전
    // 부트스트랩 첫 배치 등)인지, "틱은 있는데 캔들 집계만 빠짐"(비정상: 배치
    // 부분 실패·수동 시드 등)인지 구분해야 한다. 후자를 그냥 빈 결과로 반환하면
    // 호출부가 "오늘 틱 없음"으로 오인해 종가가 조용히 폴백값으로 오염된다.
    const { data: anyTick, error: tickError } = await supabase
      .from("daily_ticks")
      .select("stock_code")
      .eq("date", date)
      .limit(1);
    if (tickError) throw tickError;
    if (anyTick.length > 0) {
      throw new Error(
        `daily_candles가 비어 있으나 daily_ticks(${date})는 존재합니다 — 캔들 집계 누락 의심`
      );
    }
  }

  return last;
}

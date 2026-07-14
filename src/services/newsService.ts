import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { NewsGrade, NewsItem } from "@/types/domain";

export interface NewsPage {
  items: NewsItem[];
  page: number;
  hasMore: boolean;
}

const PAGE_SIZE = 20;

// 뉴스 피드 (T-503): 최신 발행순, 종목 필터 (공개 API)
//
// 발행 시각 게이트: 정식뉴스는 배치가 익일 경로의 움직임 시각으로 published_at을
// 미리 스탬프해 두므로, 아직 도래하지 않은 뉴스는 노출하지 않는다 (장중 시간차 노출).
// 공시는 폐장 시각으로 스탬프되어 폐장 순간부터 보인다.
export async function getNewsFeed(stockCode: string | null, page: number): Promise<NewsPage> {
  const supabase = getSupabaseAdmin();
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("news")
    .select("id, date, stock_code, grade, title, body, published_at, stocks(name)")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE);
  if (stockCode) {
    query = query.eq("stock_code", stockCode);
  }

  const { data, error } = await query;
  if (error) throw error;

  const hasMore = data.length > PAGE_SIZE;
  const items: NewsItem[] = data.slice(0, PAGE_SIZE).map((n) => ({
    id: n.id,
    date: n.date,
    stockCode: n.stock_code,
    stockName: n.stock_code
      ? ((n.stocks as unknown as { name: string } | null)?.name ?? null)
      : null,
    grade: n.grade as NewsGrade,
    title: n.title,
    body: n.body,
    publishedAt: n.published_at,
  }));

  return { items, page, hasMore };
}

import "server-only";
import { NEWS_OUTLETS, outletIndexBySlug } from "@/lib/news/outlets";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { NewsGrade, NewsItem } from "@/types/domain";

export interface NewsPage {
  items: NewsItem[];
  page: number;
  hasMore: boolean;
}

const PAGE_SIZE = 20;

interface NewsRow {
  id: number;
  date: string;
  stock_code: string | null;
  grade: string;
  title: string;
  body: string;
  published_at: string;
  stocks: unknown;
}

function toNewsItem(n: NewsRow): NewsItem {
  return {
    id: n.id,
    date: n.date,
    stockCode: n.stock_code,
    stockName: n.stock_code
      ? ((n.stocks as { name: string } | null)?.name ?? null)
      : null,
    grade: n.grade as NewsGrade,
    title: n.title,
    body: n.body,
    publishedAt: n.published_at,
  };
}

export interface NewsFeedFilter {
  stockCode?: string | null;
  outletSlug?: string | null; // 정식 뉴스 매체 slug (지정 시 해당 매체만)
}

// 뉴스 피드 (T-503): 최신 발행순, 종목·매체 필터 (공개 API)
//
// 발행 시각 게이트: 정식뉴스는 배치가 익일 경로의 움직임 시각으로 published_at을
// 미리 스탬프해 두므로, 아직 도래하지 않은 뉴스는 노출하지 않는다 (장중 시간차 노출).
// 공시는 폐장 시각으로 스탬프되어 폐장 순간부터 보인다.
export async function getNewsFeed(filter: NewsFeedFilter, page: number): Promise<NewsPage> {
  // 매체 필터는 배정 규칙(id % 매체수)이 클라이언트 파생값이라 SQL로 못 거른다.
  // 정식 뉴스는 전체 이벤트 기간에도 소량이므로, 전량 조회 후 JS에서 필터·페이지한다.
  if (filter.outletSlug) {
    return getOutletFeed(filter.outletSlug, page);
  }

  const supabase = getSupabaseAdmin();
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("news")
    .select("id, date, stock_code, grade, title, body, published_at, stocks(name)")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE);
  if (filter.stockCode) {
    query = query.eq("stock_code", filter.stockCode);
  }

  const { data, error } = await query;
  if (error) throw error;

  const hasMore = data.length > PAGE_SIZE;
  const items = (data as NewsRow[]).slice(0, PAGE_SIZE).map(toNewsItem);

  return { items, page, hasMore };
}

// 특정 매체의 정식 뉴스만 모아 최신순으로 페이지네이션
async function getOutletFeed(outletSlug: string, page: number): Promise<NewsPage> {
  const index = outletIndexBySlug(outletSlug);
  if (index < 0) return { items: [], page, hasMore: false };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("news")
    .select("id, date, stock_code, grade, title, body, published_at, stocks(name)")
    .eq("grade", "news")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;

  const mine = (data as NewsRow[]).filter((n) => n.id % NEWS_OUTLETS.length === index);
  const from = (page - 1) * PAGE_SIZE;
  const items = mine.slice(from, from + PAGE_SIZE).map(toNewsItem);

  return { items, page, hasMore: mine.length > from + PAGE_SIZE };
}

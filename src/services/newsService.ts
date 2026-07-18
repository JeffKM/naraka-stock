import "server-only";
import { ApiException } from "@/lib/api/response";
import { NEWS_OUTLETS, outletIndexBySlug } from "@/lib/news/outlets";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { NewsGrade, NewsItem } from "@/types/domain";

export type NewsReactionKind = "up" | "down";

export interface NewsFeedItem extends NewsItem {
  upCount: number;
  downCount: number;
  myReaction: NewsReactionKind | null;
}

export interface NewsPage {
  items: NewsFeedItem[];
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
  source: string | null;
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
    source: n.source,
    publishedAt: n.published_at,
  };
}

export interface NewsFeedFilter {
  stockCode?: string | null;
  outletSlug?: string | null; // 정식 뉴스 매체 slug (지정 시 해당 매체만)
}

// 뉴스 id 목록의 up/down 카운트 + 뷰어 본인 반응을 한 번에 집계한다.
async function reactionSummary(
  newsIds: number[],
  viewerId: number | null
): Promise<Map<number, { up: number; down: number; mine: NewsReactionKind | null }>> {
  const summary = new Map<
    number,
    { up: number; down: number; mine: NewsReactionKind | null }
  >();
  if (newsIds.length === 0) return summary;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("news_reactions")
    .select("news_id, user_id, kind")
    .in("news_id", newsIds);
  if (error) throw error;
  for (const row of data) {
    const entry = summary.get(row.news_id) ?? { up: 0, down: 0, mine: null };
    if (row.kind === "up") entry.up += 1;
    else entry.down += 1;
    if (viewerId !== null && row.user_id === viewerId) {
      entry.mine = row.kind as NewsReactionKind;
    }
    summary.set(row.news_id, entry);
  }
  return summary;
}

// NewsItem 배열에 반응 집계를 입혀 NewsFeedItem 배열로 만든다.
async function withReactions(
  items: NewsItem[],
  viewerId: number | null
): Promise<NewsFeedItem[]> {
  const summary = await reactionSummary(
    items.map((n) => n.id),
    viewerId
  );
  return items.map((n) => {
    const r = summary.get(n.id);
    return {
      ...n,
      upCount: r?.up ?? 0,
      downCount: r?.down ?? 0,
      myReaction: r?.mine ?? null,
    };
  });
}

// 뉴스 피드 (T-503): 최신 발행순, 종목·매체 필터 (공개 API)
//
// 발행 시각 게이트: 정식뉴스는 배치가 익일 경로의 움직임 시각으로 published_at을
// 미리 스탬프해 두므로, 아직 도래하지 않은 뉴스는 노출하지 않는다 (장중 시간차 노출).
// 공시는 폐장 시각으로 스탬프되어 폐장 순간부터 보인다.
export async function getNewsFeed(
  filter: NewsFeedFilter,
  page: number,
  viewerId: number | null
): Promise<NewsPage> {
  // 매체 필터는 배정 규칙(id % 매체수)이 클라이언트 파생값이라 SQL로 못 거른다.
  // 정식 뉴스는 전체 이벤트 기간에도 소량이므로, 전량 조회 후 JS에서 필터·페이지한다.
  if (filter.outletSlug) {
    return getOutletFeed(filter.outletSlug, page, viewerId);
  }

  const supabase = getSupabaseAdmin();
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("news")
    .select("id, date, stock_code, grade, title, body, source, published_at, stocks(name)")
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
  const base = (data as NewsRow[]).slice(0, PAGE_SIZE).map(toNewsItem);
  const items = await withReactions(base, viewerId);

  return { items, page, hasMore };
}

// 특정 매체의 정식 뉴스만 모아 최신순으로 페이지네이션
async function getOutletFeed(
  outletSlug: string,
  page: number,
  viewerId: number | null
): Promise<NewsPage> {
  const index = outletIndexBySlug(outletSlug);
  if (index < 0) return { items: [], page, hasMore: false };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("news")
    .select("id, date, stock_code, grade, title, body, source, published_at, stocks(name)")
    .eq("grade", "news")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;

  const mine = (data as NewsRow[]).filter((n) => n.id % NEWS_OUTLETS.length === index);
  const from = (page - 1) * PAGE_SIZE;
  const base = mine.slice(from, from + PAGE_SIZE).map(toNewsItem);
  const items = await withReactions(base, viewerId);

  return { items, page, hasMore: mine.length > from + PAGE_SIZE };
}

// 뉴스 반응 토글: 같은 방향 재클릭이면 취소, 다른 방향이면 전환, 없으면 추가.
// 새 본인 반응과 up/down 카운트를 돌려준다.
export async function toggleNewsReaction(
  userId: number,
  newsId: number,
  kind: NewsReactionKind
): Promise<{ myReaction: NewsReactionKind | null; upCount: number; downCount: number }> {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: selError } = await supabase
    .from("news_reactions")
    .select("kind")
    .eq("news_id", newsId)
    .eq("user_id", userId)
    .maybeSingle();
  if (selError) throw selError;

  let myReaction: NewsReactionKind | null;
  if (existing && existing.kind === kind) {
    const { error } = await supabase
      .from("news_reactions")
      .delete()
      .eq("news_id", newsId)
      .eq("user_id", userId);
    if (error) throw error;
    myReaction = null;
  } else {
    // 없는 뉴스면 FK 위반 → NOT_FOUND
    const { error } = await supabase
      .from("news_reactions")
      .upsert(
        { news_id: newsId, user_id: userId, kind },
        { onConflict: "news_id,user_id" }
      );
    if (error) {
      // FK 위반(23503) = 없는 뉴스 → NOT_FOUND. 그 외 에러는 그대로 던져
      // handleApiError가 로깅·INTERNAL 응답하게 둔다.
      if (error.code === "23503") {
        throw new ApiException("NOT_FOUND", "없는 뉴스입니다.");
      }
      throw error;
    }
    myReaction = kind;
  }

  const { data: rows, error: countError } = await supabase
    .from("news_reactions")
    .select("kind")
    .eq("news_id", newsId);
  if (countError) throw countError;
  const upCount = rows.filter((r) => r.kind === "up").length;
  const downCount = rows.filter((r) => r.kind === "down").length;

  return { myReaction, upCount, downCount };
}

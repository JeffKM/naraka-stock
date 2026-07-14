// 정식 뉴스 매체 풀 — 유명 매체를 나라카 세계관으로 비튼 언론사.
// 게시물 id로 고정 배정(id % length)해 같은 뉴스는 항상 같은 매체로 노출된다.
// 피드 표시(클라이언트)와 매체별 집계(서버)가 같은 배정 규칙을 공유하도록
// 여기를 단일 진실로 둔다.

export interface NewsOutlet {
  slug: string; // URL·필터용 안정 식별자
  name: string;
  handle: string;
  avatar: string;
}

export const NEWS_OUTLETS: NewsOutlet[] = [
  { slug: "daily", name: "나라카 데일리", handle: "@naraka_daily", avatar: "데일" },
  { slug: "biz", name: "나라카경제", handle: "@naraka_biz", avatar: "경제" },
  { slug: "journal", name: "나라카 저널", handle: "@naraka_journal", avatar: "저널" },
  { slug: "herald", name: "나라카 헤럴드", handle: "@naraka_herald", avatar: "헤럴" },
  { slug: "times", name: "나라카타임스", handle: "@naraka_times", avatar: "타임" },
  { slug: "bc", name: "나라카방송", handle: "@naraka_bc", avatar: "방송" },
  { slug: "post", name: "나라카포스트", handle: "@naraka_post", avatar: "포스" },
];

// 게시물 id → 배정 매체 (정식 뉴스 전용)
export function outletForNewsId(id: number): NewsOutlet {
  return NEWS_OUTLETS[id % NEWS_OUTLETS.length];
}

export function outletBySlug(slug: string): NewsOutlet | undefined {
  return NEWS_OUTLETS.find((o) => o.slug === slug);
}

// slug → 배정 인덱스 (id % length 필터용). 없는 slug면 -1.
export function outletIndexBySlug(slug: string): number {
  return NEWS_OUTLETS.findIndex((o) => o.slug === slug);
}

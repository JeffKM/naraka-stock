-- 소셜확장 반응 테이블 (몰입 스펙 2026-07-18 §2-1, §2-3)
--
-- 원본 대화는 stock_comments 하나로 유지하고, 반응만 분리한다.
-- comment_reactions: 댓글 엄지업(1인 1회, 방향 없음 = 존재/부재 토글).
-- news_reactions: 뉴스 카드 엄지업/엄지다운(1뉴스당 1방향, 재클릭 토글·전환).
-- 둘 다 FK on delete cascade → 유저·댓글·뉴스 삭제 시 자동 정리
-- (reset_rehearsal_data가 users/news를 지우면 반응도 따라 사라져 별도 수정 불필요).

create table comment_reactions (
  comment_id bigint not null references stock_comments (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index comment_reactions_comment_idx on comment_reactions (comment_id);

create table news_reactions (
  news_id bigint not null references news (id) on delete cascade,
  user_id bigint not null references users (id) on delete cascade,
  kind text not null check (kind in ('up', 'down')),
  created_at timestamptz not null default now(),
  primary key (news_id, user_id)
);

create index news_reactions_news_idx on news_reactions (news_id);

-- 다른 테이블과 동일하게 RLS 전면 차단 (service role만 통과)
alter table comment_reactions enable row level security;
alter table comment_reactions force row level security;
alter table news_reactions enable row level security;
alter table news_reactions force row level security;

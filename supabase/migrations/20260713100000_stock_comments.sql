-- 종목 토론방 (토스 벤치마킹): 종목 상세 하단 실시간 댓글
--
-- 밈·찌라시가 자유롭게 돌 수 있는 가벼운 커뮤니티. 작성자 본인 삭제만 허용하고
-- 문제 유저는 기존 계정 정지(is_banned)로 차단한다. 유저 삭제 시 댓글도 cascade.

create table stock_comments (
  id bigint generated always as identity primary key,
  stock_code text not null references stocks (code),
  user_id bigint not null references users (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 200),
  created_at timestamptz not null default now()
);

create index stock_comments_stock_idx on stock_comments (stock_code, created_at desc);

-- 다른 테이블과 동일하게 RLS 전면 차단 (service role만 통과)
alter table stock_comments enable row level security;
alter table stock_comments force row level security;

-- 고객센터 게시판: 버그 신고·문의·건의 접수 + 운영자 답변
--
-- 유저가 글을 남기면 운영자가 콘솔에서 천천히 확인하고 답변/완료 처리한다.
-- 리허설 초기화(reset_rehearsal_data)가 유저를 지울 때 글도 함께 지워지도록 cascade.

create table support_posts (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id) on delete cascade,
  category text not null check (category in ('bug', 'inquiry', 'suggestion')),
  content text not null check (char_length(content) between 2 and 1000),
  status text not null default 'open' check (status in ('open', 'done')),
  reply text, -- 운영자 답변 (없을 수 있음)
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

create index support_posts_user_idx on support_posts (user_id, created_at desc);
create index support_posts_status_idx on support_posts (status, created_at desc);

-- 다른 테이블과 동일하게 RLS 전면 차단 (service role만 통과)
alter table support_posts enable row level security;
alter table support_posts force row level security;

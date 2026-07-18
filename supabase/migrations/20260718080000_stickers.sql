-- 스티커 카탈로그 + 댓글 첨부 (몰입 스펙 §2-4)
-- 1단계: 이미지를 data URI(base64)로 DB에 직접 저장. 어드민에서 배포 없이 추가.
-- 2단계(대량화 시): storage_path 추가로 Supabase Storage 이관 — 소비 코드는 imageUrl만 봄.

create table stickers (
  id text primary key,
  label text not null,
  image_data_uri text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index stickers_active_idx on stickers (is_active, sort_order);

-- 다른 테이블과 동일하게 RLS 전면 차단 (service role만 통과)
alter table stickers enable row level security;
alter table stickers force row level security;

-- 댓글에 스티커 첨부: 없으면 텍스트만, 있으면 텍스트 생략 가능
-- 스티커 하드 삭제 시 기존 댓글은 텍스트만 남기고 깨지지 않도록 set null
alter table stock_comments
  add column sticker_id text null references stickers (id) on delete set null;

-- content NOT NULL 완화 + 길이 체크 재정의
-- (원본은 인라인 check → Postgres 자동명 stock_comments_content_check)
alter table stock_comments alter column content drop not null;
alter table stock_comments drop constraint if exists stock_comments_content_check;
alter table stock_comments add constraint stock_comments_content_len
  check (content is null or char_length(content) between 1 and 200);

-- 텍스트·스티커 중 최소 하나는 필수
alter table stock_comments add constraint stock_comments_has_body
  check (content is not null or sticker_id is not null);

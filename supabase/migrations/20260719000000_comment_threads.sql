-- 대댓글(중첩 스레드) + 묘비 삭제 (UI 개선 Phase D)
--
-- parent_id 자기참조로 2단계 스레드를 만든다. 2단계 제한(답글에 답글 금지)은
-- 서비스 레이어에서 강제한다. 답글이 달린 부모를 삭제하면 하드삭제 대신 deleted_at을
-- 세팅해 "삭제된 댓글입니다" 묘비로 남기고 답글을 보존한다.

-- 부모 하드삭제 시 답글도 함께 정리되도록 자기참조 cascade
alter table stock_comments
  add column parent_id bigint null references stock_comments (id) on delete cascade;

-- 소프트 삭제(묘비) 마커
alter table stock_comments
  add column deleted_at timestamptz null;

-- 부모별 답글을 created_at asc(대화 흐름)로 조회하기 위한 인덱스
create index stock_comments_parent_idx on stock_comments (parent_id, created_at asc);

-- 묘비 행은 content·sticker 둘 다 null이 되므로 has_body 제약을 완화한다
alter table stock_comments drop constraint if exists stock_comments_has_body;
alter table stock_comments add constraint stock_comments_has_body
  check (deleted_at is not null or content is not null or sticker_id is not null);

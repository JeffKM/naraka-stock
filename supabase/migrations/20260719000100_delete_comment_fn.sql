-- 댓글 삭제 원자화: 답글이 있으면 묘비(소프트), 없으면 하드 삭제를 한 트랜잭션으로 처리.
-- 카운트-확인과 삭제 사이에 답글이 유입돼 cascade로 조용히 유실되는 TOCTOU 경합을 제거한다.
-- 대상 행을 FOR UPDATE로 잠그면, 답글 insert가 부모에 대해 FOR KEY SHARE 락을 필요로 하므로
-- 둘이 직렬화된다: 삭제가 먼저면 답글 insert는 FK 위반(부모 없음)으로 실패해 작성자에게 통지되고,
-- 답글이 먼저면 삭제는 답글 존재를 보고 묘비 처리해 답글을 보존한다.
-- p_restrict_user_id가 null이 아니면 그 유저 소유 댓글만(비어드민), null이면 무제한(어드민).
-- 반환: 처리된 댓글 id, 대상이 없거나 권한 없으면 null.
create or replace function delete_comment(p_comment_id bigint, p_restrict_user_id bigint)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
  v_has_children boolean;
begin
  select id into v_id
  from stock_comments
  where id = p_comment_id
    and deleted_at is null
    and (p_restrict_user_id is null or user_id = p_restrict_user_id)
  for update;

  if v_id is null then
    return null;
  end if;

  select exists(select 1 from stock_comments where parent_id = p_comment_id)
    into v_has_children;

  if v_has_children then
    update stock_comments
      set deleted_at = now(), content = null, sticker_id = null
      where id = p_comment_id;
  else
    delete from stock_comments where id = p_comment_id;
  end if;

  return p_comment_id;
end;
$$;

-- 다른 RPC들과 동일하게 service_role에만 실행 권한 부여 (하우스 컨벤션)
grant execute on function delete_comment(bigint, bigint) to service_role;

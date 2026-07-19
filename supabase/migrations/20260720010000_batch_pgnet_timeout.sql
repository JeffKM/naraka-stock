-- 일일 배치 pg_net 응답 대기 timeout 상향: 60000ms → 120000ms.
--
-- 배경: 10초 틱 전환으로 배치가 ~48초 소요(청크 삽입 181k + 캔들 42 + 뉴스 + 정산).
-- Vercel maxDuration은 300초로 상향했으나, pg_cron이 net.http_post로 배치를 호출할 때의
-- 응답 대기(timeout_milliseconds)가 60초면 배치가 60초를 넘길 경우 pg_cron이 응답을
-- 못 받아 실패로 기록한다(함수 자체는 완주해도). 대기 시간을 120초로 늘려 여유를 준다.
--
-- 이 cron job(URL·시크릿·timeout 포함 command)은 prod에 수동 생성돼 마이그레이션에
-- 없다. 시크릿을 리포에 커밋하지 않기 위해, 기존 command를 cron.job에서 읽어
-- timeout_milliseconds 값만 정규식으로 치환하고 되쓴다(시크릿·URL은 DB에만 유지).
-- 로컬(pg_cron 미설치)에서는 건너뛴다. 멱등(재적용해도 120000 유지).
do $$
declare
  r record;
  v_new text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron 미설치 — daily-batch pg_net timeout 조정 건너뜀(로컬)';
    return;
  end if;

  for r in
    select jobid, command
    from cron.job
    where command ilike '%daily-batch%'
  loop
    if r.command ~ 'timeout_milliseconds' then
      v_new := regexp_replace(
        r.command,
        'timeout_milliseconds\s*=>\s*[0-9]+',
        'timeout_milliseconds => 120000',
        'g'
      );
      perform cron.alter_job(job_id := r.jobid, command := v_new);
      raise notice 'daily-batch job % 의 pg_net timeout을 120000ms로 조정', r.jobid;
    else
      raise notice 'daily-batch job % 에 timeout_milliseconds 인자 없음 — 수동 확인 필요', r.jobid;
    end if;
  end loop;
end $$;

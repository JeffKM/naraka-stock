-- 뉴스 출처(기자·매체명) 컬럼 추가 (수동 찌라시용)
--
-- 수동 발행 뉴스는 항상 찌라시(rumor)이며, 사장님이 "옥자", "나라카 숲" 같은
-- 제보자·매체 이름을 직접 지정한다. 자동 뉴스(공시·정식뉴스)는 source가 null이며
-- 클라이언트에서 등급별 규칙으로 매체를 파생하므로 이 컬럼을 쓰지 않는다.
alter table news add column if not exists source text;

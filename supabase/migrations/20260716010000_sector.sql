-- 종목 섹터 분류 (피드백 3) — tier(우량/일반/테마)와 직교하는 업종 축.
-- 표시·필터·뉴스 섹터 이벤트 타겟팅에 쓴다. 지수 분류(NASPI/NASDAK)는 tier 파생 그대로.
alter table stocks add column if not exists sector text;

update stocks set sector = 'semiconductor' where code in ('MLVD','OKHX');
update stocks set sector = 'electronics'   where code in ('NRKE','MAPL');
update stocks set sector = 'it'            where code in ('ALBN','NOMH','MRSF','MRCL','BBNN','MLTA');
update stocks set sector = 'retail'        where code in ('BNZN','MLMT','OKCT','MIPA','MHBT','OKCC');
update stocks set sector = 'auto'          where code in ('OKSL','NRKM');
update stocks set sector = 'media'         where code in ('OKFX','MHEN');
update stocks set sector = 'finance'       where code in ('BNSK','MRFI');
update stocks set sector = 'defense'       where code in ('SPCO','BNAS','BNOC');
update stocks set sector = 'bio'           where code in ('NRKB','MELL');

-- 이후 신규 종목 강제: NOT NULL + 체크
alter table stocks alter column sector set not null;
alter table stocks add constraint stocks_sector_check
  check (sector in ('semiconductor','electronics','it','retail','auto','media','finance','defense','bio'));

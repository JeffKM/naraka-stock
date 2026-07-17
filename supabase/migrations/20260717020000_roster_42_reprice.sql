-- 로스터 확장 27→42 + 전 종목 기준가·시총 재설계 + 섹터 재배치 + 지수 재부트스트랩
-- (섹터 개편 Plan 2). 개장 전 전제 — 파생 리허설 데이터는 Plan 5에서 재생성한다.

-- 1) 신규 15종 등록 (sector FK는 Plan 1 seed에 존재)
insert into stocks (code, name, tier, sector, description, shares_outstanding) values
  ('OKSC','옥스코','stable','materials','쇠와 불의 명가. 나라카 산업의 뼈대를 대는 철강·소재 대장주.',40000000),
  ('MHOL','미호오일','stable','energy','기름 한 방울에 울고 웃는 정유 대장. 유가 소식에 출렁인다.',38000000),
  ('BNMR','바나모레퍼시픽','stable','cosmetics','피부에 진심인 화장품 명가. 유행 한 방에 매출이 널뛴다.',36000000),
  ('RTMC','리얼티 멜컴','stable','construction','매달 꼬박꼬박 배당 주는 부동산 임대 리츠의 대명사.',45000000),
  ('NRKR','나라카로보틱스','stable','robotics','협동로봇의 선두. 자동화 붐마다 급등락 단골.',40000000),
  ('NRKC','나라카화학','normal','materials','플라스틱부터 배터리 소재까지, 나라카 화학의 자존심.',27000000),
  ('NRKH','나라카중공업','normal','defense','거대 엔진과 결계 설비를 찍어내는 중공업 강자.',26000000),
  ('OKTL','OKT','normal','telecom','요괴 통신망을 깐 통신 1위. 요금제·5G 소식에 반응한다.',27000000),
  ('MHRN','미호리온','normal','food','과자 봉지 하나로 입맛을 평정한 국민 간식 회사.',22000000),
  ('BNEN','바나나에너빌리티','normal','energy','원자로와 발전 설비의 명가. 나라카에 불을 대는 에너지주.',30000000),
  ('NRKG','나라카건설','normal','construction','탑과 다리를 올리는 건설 대장. 수주 소식에 들썩인다.',23000000),
  ('MLAB','멜어비스','normal','game','대작 게임 하나에 운명을 거는 게임사. 신작 소식에 급등락.',22000000),
  ('MHTR','미호토로라','wild','telecom','무전기부터 공공안전 장비까지, 통신 장비 노포.',18000000),
  ('MLTV','멜튜이티브','wild','robotics','수술 로봇 팔의 절대강자. 정밀 의료의 미래주.',23000000),
  ('OKBX','옥블록스','wild','game','누구나 게임을 만드는 메타 놀이터. 밈 한 방에 널뛴다.',24000000);

-- 2) 신규 15종 기준일 베이스라인 (2026-07-31 = 개장 첫날 틱 기준가)
insert into daily_summary (stock_code, date, open, high, low, close, bias) values
  ('OKSC','2026-07-31',1100000,1100000,1100000,1100000,0),
  ('MHOL','2026-07-31', 950000, 950000, 950000, 950000,0),
  ('BNMR','2026-07-31', 900000, 900000, 900000, 900000,0),
  ('RTMC','2026-07-31', 700000, 700000, 700000, 700000,0),
  ('NRKR','2026-07-31', 600000, 600000, 600000, 600000,0),
  ('NRKC','2026-07-31', 800000, 800000, 800000, 800000,0),
  ('NRKH','2026-07-31', 780000, 780000, 780000, 780000,0),
  ('OKTL','2026-07-31', 550000, 550000, 550000, 550000,0),
  ('MHRN','2026-07-31', 600000, 600000, 600000, 600000,0),
  ('BNEN','2026-07-31', 450000, 450000, 450000, 450000,0),
  ('NRKG','2026-07-31', 400000, 400000, 400000, 400000,0),
  ('MLAB','2026-07-31', 300000, 300000, 300000, 300000,0),
  ('MHTR','2026-07-31', 180000, 180000, 180000, 180000,0),
  ('MLTV','2026-07-31', 130000, 130000, 130000, 130000,0),
  ('OKBX','2026-07-31',  85000,  85000,  85000,  85000,0);

-- 3) 섹터 재배치 (기존 5종 중 4종 이동, BNAS는 defense 유지)
update stocks set sector='food'     where code='OKCC';
update stocks set sector='cosmetics' where code='MHBT';
update stocks set sector='shipaero' where code in ('BNOC','SPCO');

-- 4) 기존 27종 발행주식수 재설계
update stocks s set shares_outstanding = v.shares
from (values
  ('MLVD',90000000),('NRKE',85000000),('MAPL',75000000),('ALBN',70000000),
  ('BNZN',65000000),('OKHX',60000000),('OKSL',55000000),('NOMH',45000000),
  ('MLMT',33000000),('MRSF',30000000),('OKCT',20000000),('NRKM',30000000),
  ('MRCL',25000000),('OKFX',23000000),('BNOC',25000000),('MRFI',22000000),
  ('BNSK',21000000),('MIPA',22000000),('MHEN',24000000),('MLTA',25000000),
  ('BBNN',26000000),('SPCO',26000000),('NRKB',30000000),('MHBT',30000000),
  ('MELL',32000000),('BNAS',34000000),('OKCC',36000000)
) as v(code, shares)
where s.code = v.code;

-- 5) 기존 27종 기준일 기준가 재설계 (×10 스케일, 신규 밴드)
update daily_summary ds set open=v.p, high=v.p, low=v.p, close=v.p
from (values
  ('MLVD',1950000),('NRKE',1750000),('MAPL',1850000),('ALBN',1800000),
  ('BNZN',1700000),('OKHX',1650000),('OKSL',1550000),('NOMH',1200000),
  ('MLMT',1050000),('MRSF', 980000),('OKCT', 900000),('NRKM', 850000),
  ('MRCL', 700000),('OKFX', 620000),('BNOC', 500000),('MRFI', 420000),
  ('BNSK', 380000),('MIPA', 350000),('MHEN', 240000),('MLTA', 220000),
  ('BBNN', 200000),('SPCO', 150000),('NRKB', 120000),('MHBT', 100000),
  ('MELL',  75000),('BNAS',  60000),('OKCC',  50000)
) as v(code, p)
where ds.stock_code = v.code and ds.date = '2026-07-31';

-- 6) 지수 divisor 재부트스트랩 (기준일 42종 시총으로 나스피/나스닥 = 1,000pt)
update market_indices mi set divisor = sub.divisor
from (
  select case when s.tier='wild' then 'NASDAK' else 'NASPI' end as code,
         sum(ds.close::numeric * s.shares_outstanding) / 1000 as divisor
  from stocks s
  join daily_summary ds on ds.stock_code = s.code and ds.date = '2026-07-31'
  where s.listed
  group by 1
) sub
where mi.code = sub.code;

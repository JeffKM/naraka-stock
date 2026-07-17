-- 자금 스케일: 초기자금 100만→1,000만, 방문보너스 10만→100만, 기존 유저 +900만 (섹터 개편 Plan 2)

-- 1) 신규 가입 초기자금 (users.cash 컬럼 default)
alter table users alter column cash set default 10000000;

-- 2) config 값 (표시·시뮬·보너스 RPC 참조)
update config set value = '10000000' where key = 'initial_cash';
update config set value = '1000000'  where key = 'visit_bonus';

-- 3) 기존 가입자 전원 +900만 일회성 (100만 출발자를 1,000만 출발선에 맞춤)
update users set cash = cash + 9000000;

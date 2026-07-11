# 배포 가이드 — 나라카 증권거래소 (T-702/T-703)

> ✅ **배포 완료 (2026-07-12)**: https://naraka-stock.vercel.app
> Supabase `suowtstolxzpnjdolfrn` (ap-northeast-2) · pg_cron `naraka-daily-batch` 매일 22:00 KST 등록됨.
> 아래 §1~3은 완료된 절차의 기록이고, 남은 것은 **§4 어드민 승격 + §5 리허설**이다.
> 일정: 07-15(수)부터 리허설 장 가능 → 08-01 15:00 개장

## 1. Supabase 프로덕션 프로젝트

1. [supabase.com](https://supabase.com)에서 새 프로젝트 생성 (리전: Northeast Asia 권장)
2. 로컬에서 연결 후 마이그레이션 적용:
   ```bash
   npx supabase link --project-ref <프로젝트-REF>
   npx supabase db push
   ```
3. 프로덕션 시드 (SQL Editor에서 실행):
   - `supabase/seed.sql`에서 **종목 8종 + 기준가(07-31) + config 블록만** 실행
   - ⚠️ 테스트 가입 코드(`TEST-*`)·방문 코드(`VISIT-TEST`) 블록은 **실행 금지** — 운영 코드는 어드민 콘솔에서 생성

## 2. Vercel 배포

1. GitHub 레포 연결 → Import (Framework: Next.js, 기본 설정)
2. 환경 변수 등록 (Production):

   | 변수 | 값 |
   |------|-----|
   | `SUPABASE_URL` | Supabase Dashboard → Settings → API의 Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | 같은 화면의 service_role 키 (**절대 공개 금지**) |
   | `SESSION_SECRET` | `openssl rand -hex 32` 결과 |
   | `CRON_SECRET` | `openssl rand -hex 32` 결과 (아래 pg_cron과 동일 값) |

3. 배포 후 도메인 확인 (예: `naraka-stock.vercel.app`)

## 3. pg_cron 일일 배치 등록 (매일 22:00 KST)

Supabase SQL Editor에서 실행 (`<도메인>`·`<CRON_SECRET>` 치환):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'naraka-daily-batch',
  '0 13 * * *',  -- 13:00 UTC = 22:00 KST
  $$
  select net.http_post(
    url := 'https://<도메인>/api/cron/daily-batch',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <CRON_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- 등록 확인 / 삭제
select * from cron.job;
-- select cron.unschedule('naraka-daily-batch');
```

수동 실행(리허설·장애 복구용):
```bash
curl -X POST "https://<도메인>/api/cron/daily-batch" \
  -H "Authorization: Bearer <CRON_SECRET>"
# 특정 날짜로 실행: ...?date=2026-07-31
```

## 4. 최초 어드민 승격

사장님 계정을 일반 가입시킨 뒤 SQL Editor에서:

```sql
update users set is_admin = true where nickname = '<사장님닉네임>';
```

## 5. 리허설 체크리스트 (T-703, 07-29~31)

- [ ] 어드민: 가입 코드 묶음 생성 → 인쇄물 준비
- [ ] 어드민: 방문 코드 14일 자동 생성 확인
- [ ] 테스트 계정 가입 → 방문 보너스 입력 → 매수/매도 (장 시간에)
- [ ] 22:00 배치 자동 실행 확인 (`select * from cron.job_run_details order by start_time desc limit 5;`)
- [ ] 배치 후: 익일 틱 672개 생성 + 뉴스 발행 + 시세판/차트 정상 확인
- [ ] 07-31(금) 22:00 배치가 08-01 경로를 만드는지 확인 ← **개장 전 마지막 관문**
- [ ] 서킷브레이커·깜짝 이벤트 발동 테스트 (장중)
- [ ] 리허설 데이터 초기화: `delete from trades; delete from holdings; delete from visit_claims;`
  `update users set cash = 1000000 where is_admin = false;` (또는 테스트 계정 삭제)
  `delete from daily_ticks where date < '2026-08-01'; delete from daily_summary where date < '2026-07-31'; delete from news;`
  `update signup_codes set used_by = null, used_at = null where ...;` — 필요 시 선별 초기화

## 6. 개장일 (08-01)

- 15:00 자동 개장 (07-31 배치가 만든 경로 사용)
- 첫날은 공시 없음(전일 데이터 없음), 힌트 뉴스는 07-31 배치가 발행

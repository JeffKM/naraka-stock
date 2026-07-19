# 밸런스·공정성 감사 리포트 — 2026-07-20

> **정식 풀 실행 (balance-harness 정식 1회)** — 세 도메인 검증관(price-engine / trade-integrity / batch-tick) 팬인 종합.
> 대상: HEAD 42c2896 (worktree-secure), 변경분 한정 아님. 리포트 3종 전부 수집 완료(미수집 없음).

## 총평 (공정성 판정: **조건부 통과**)

**정식 풀 검증 결과, 공정성 불변식·거래 무결성·가격 엔진은 모두 통과(리그레션 없음)다. 그러나 최상단에 배포 블로커가 하나 있다.**

> **[배포 블로커·최상위] 브랜치 드리프트 — 이 브랜치 배치 코드를 현재 라이브(main 스키마) DB에 태우면 틱 0건(전 종목 빈 차트)으로 이벤트가 마비된다.** `batch-tick`·`trade-integrity` 두 검증관이 **독립적으로 확증**했다. worktree-secure 마이그는 `20260719000100`에서 끝나고, 라이브 DB는 `20260719160000`까지(파일 없는 후속 6~7종, 10초 틱 전환 계열) 적용된 상태다. worktree-secure의 `batchService`는 `p_ticks`를 전달하지만 라이브 `apply_daily_batch`는 이를 무시하고 청크 RPC(`insert_daily_ticks_chunk`)를 기대하므로 `ticksInserted:0`이 된다. **자금 계산 로직(잔고검증·수수료·반올림·예약·평단·원자성)은 두 버전 동일**이므로 무결성·공정성 결론 자체는 커밋 코드에도 유효하다. → **main 리베이스로 배치·틱 개편 6종을 흡수하기 전에는 이 브랜치를 프로덕션/라이브 DB에 배포 금지.**

**공정성 판정을 "조건부 통과"로 두는 이유:** 공정성 불변식(초기자금·보너스 중복차단·정수 원·뉴스 편향 등급)과 상대 밸런스(스프레드 1.87× < 2× 기준)는 그 자체로 **통과**다. 브랜치 드리프트는 참가자 전원에게 동일하게 "데이터 없음"을 노출하므로 **정보/기회 불평등(공정성 위반)이 아니라 운영 마비**다. 다만 이벤트가 성립하려면 배포 게이팅 조건을 반드시 충족해야 하므로 무조건 통과가 아닌 **조건부**로 판정한다.

---

## 도메인별 요약

### 가격 엔진·시뮬 (price-engine-verifier) — PASS 9 / FAIL 0 / 의심 2
- 결정론·상하한 ±30% 클램프(60,000경로 위반 0)·VI ±8% 마킹·σ 서열(.005/.009/.015 단조)·개장갭 방향중립·RNG 건전성 전부 PASS.
- OU 브라켓 차익거래 **자멸 회귀 재확인**(전 변형 손실율 99~100%, 실배수 0.62~0.91×). 뉴스추종 tail 노출로 이득 제거(중앙값 0.861×).
- 배수 해석: `INITIAL_CASH=10,000,000`(원금×10), 표시값 ÷ 10 = 실배수. 표시 10.0배 = 본전.

### 거래 무결성 (trade-integrity-verifier) — 8/8 항목 × 3 RPC 전부 PASS
- 체결가=서버 현재 틱(`execute_trade`에 price 인자 없음, p_at 실측 12:00→100000 / 13:00→222222). 매도 수수료 0.5% floor 1회, 매수 fee=0, 소수주 왕복 20회 원 누수 0.
- 동시 매수 `FOR UPDATE` 직렬화 실증(dblink 2-백엔드), `CHECK(cash>=0)` 백스톱. `settle_limit_orders`는 주문별 서브트랜잭션 완전 롤백(부분커밋 없음).
- **[E0]** 로컬 DB가 이 브랜치 커밋 마이그보다 앞섬 → 브랜치 드리프트와 동일 리스크(2명 독립 확증).

### 배치·틱 (batch-tick-verifier) — PASS(자기세계) / BLOCKING(stale코드×migrated DB)
- worktree-secure 폐쇄계에서는 틱 수 144·상하한·현재가=마지막틱·장중 읽기전용 전부 PASS.
- 과거 장애 회귀 R1(PostgREST 1000행 페이지네이션·방어됨)·R2(pg_net 타임아웃·main에서만 해소)·R3(빈 차트 부트스트랩) 확인.
- **핵심 발견: 브랜치 드리프트(총평 참조).** 라이브 daily_ticks=42종×4320=181,440행/일, worktree-secure는 144틱 하드코딩.

---

## 경계면 교차검증 결과 (개별 정상 ≠ 통합 정상)

| 경계면 | 확인 | 결과 |
|--------|------|------|
| **엔진 밴드 ↔ 거래 체결 밴드** | `execute_trade`는 밴드 직접 검사 안 함, 틱을 신뢰(주1). 시장가 밴드 준수는 "엔진이 틱을 밴드 내 생성" 불변식에 의존 | **일치** — 엔진 60,000경로 클램프 위반 0 + 라이브 daily_ticks 42/42 밴드 내(OKCC 상한 정확 터치 84320). 계약이 양 스키마(브랜치·라이브)에서 모두 성립 |
| **배치 틱 인덱스 ↔ 거래 현재가 인덱스** | 배치가 채운 인덱스 = 거래가 읽는 "현재 시각 틱 인덱스"인가 | **세계 내부는 일치, 브랜치 간 상수 상이(명시).** 라이브: 배치·거래 모두 10초/4320 모델(설치본)로 상호 정합(0..4319). worktree-secure 커밋: 5분/144 모델로 상호 정합(0..143). **깨지는 건 오직 "stale 앱 배치코드 × migrated DB 배치함수" 조합** — 틱 인덱스 shape가 아니라 삽입경로 계약(p_ticks vs 청크 RPC)이 어긋나 0건 |
| **배치 뉴스 편향 ↔ 엔진 realizeBias** | 추첨 편향과 가격 반영 편향의 값·부호 일치 | **일치** — 배치·시뮬·엔진이 동일 `bias.ts` 공유 → 구조적으로 동일 값·부호. 정식뉴스 tail 노출로 조기 정보 우위 없음 |
| **지정가 settle ↔ 배치 순서** | 실행 순서가 체결가 유·불리를 만드는가 | **중립** — 체결가=지정가 고정(틱 갭 불로소득 차단, 하락틱 85000에서도 지정가 90000 체결 실측). 순서 무관하게 지정가 확정 |
| **시뮬 상수 ↔ 실제 마이그/config** | 수수료·초기자금·드리프트·보너스가 DB와 일치하는가 | **일치(틱해상도 제외).** `INITIAL_CASH=10,000,000`=`config.initial_cash`=`users.cash default`(capital_scale). `SELL_FEE_RATE=0.005`=sell_fee_50bp. 출석 30/50/70만=`attendance_amount_1/2/3` config. **단 sim 틱해상도 144 ≠ 라이브 4320**(밸런스 절대수치는 worktree-secure 전제 하 유효) / sim 출석은 `--attendance` 기본 off |

주1: 밴드 계약은 "엔진 생성 불변식"에 위임되어 있고, 엔진·배치 양쪽에서 위반 0으로 검증되어 계약이 실제로 성립함을 교차 확인. 정적 리뷰만으로는 못 잡는 "거래가 밴드를 직접 안 막는" 위임 구조가 안전함을 실측으로 확증.

### 공정성 불변식 직접 감사 (보너스 클레임 경로 — 검증관 스코프 밖, 마이그 직독 보강)

| 불변식 | 확인 | 결과 |
|--------|------|------|
| 초기자금 1,000만 고정 | `users.cash default 10000000` + `config.initial_cash=10000000` (capital_scale) | 전원 동일 · PASS |
| 방문 보너스 1일 1회·날짜별 코드 | `claim_visit_bonus`: `visit_claims` PK `(user_id,date)`, `visit_codes.date=오늘 AND code` 검증, 중복→`CODE_ALREADY_USED`, 단일 트랜잭션 | PASS |
| 출석 스트릭 조작 불가 | `claim_attendance_bonus`: PK `(user_id,date)` 1일 1회, 스트릭 +1은 `v_prev=오늘-1`일 때만(클라 입력 없음), 금액=config `attendance_amount(streak)`, insert-before-pay unique_violation 가드 | PASS |
| 정수(원) | cash/amount 전부 bigint, config `#>>'{}'::bigint`, fee floor | PASS |
| 가입 코드 1회성 | `signup_user`: 미사용 코드 `FOR UPDATE`, `used_by` 소멸, `reset_rehearsal_data`가 사용코드 삭제로 재사용 차단. is_admin은 requireAdmin 뒤 발급 코드로만 | PASS |

> 보너스(방문·출석)는 **전 참가자 동일 조건의 균등 가산**이라 상대 순위를 왜곡하지 않는 공정성-중립 요소다. sim 분포가 출석 보너스를 기본 제외(`--attendance` off)해도 상대 밸런스 판정에는 영향 없음.

---

## 이슈 목록 (심각도순: 공정성 위협 > 리그레션 > 개선)

| # | 심각도 | 이슈 | 영향 | 재현 | 담당 도메인 |
|---|--------|------|------|------|------------|
| 1 | **BLOCKING (배포)** | **브랜치 드리프트** — worktree-secure가 main보다 배치·틱 개편 6~7종(청크삽입·config_tick_seconds 10초/4320·pgnet timeout 120000·backfill·rate_limit) 뒤처짐 | stale 앱 배치코드 × migrated 라이브 DB = **틱 0건(전 종목 빈 차트), 이벤트 마비**. 자금 로직은 동일이라 무결성 결론은 유효 | worktree-secure식 payload로 라이브 `apply_daily_batch` 호출 → `ticksInserted:0`, daily_ticks 0행(summaries만) | batch-tick + trade-integrity (2명 독립 확증) |
| 2 | 공정성 워치 | **섹터소문추종 상대 지배** — 중앙값 1.092×·평균 1.151×·손실율 38.3%로 존버 3축 모두 앞섬 | 원인=진짜소문 61.1% 예측력. **무위험 아님**(38% 손실, 능동매매+소문판독 필요). 스프레드 10.92/5.85≈**1.87× < 2× 상대해석 기준 내**, 전체 적중 55.1%(목표 하단)로 억제 | simulate runs≥2000 분포 | price-engine |
| 3 | 공정성 워치 | **top-4 상금 = 운 지배** — EV·중앙값은 전략이, 최대치(상금권)는 고분산 도박이 가름 | 잡주몰빵 8.9×·단타 5.5×(행운) vs 규율형 섹터소문 4.34× 상한. 캐주얼 이벤트론 허용 가능하나 **"상위 4명 상품이 전략보다 운"임을 운영 공지에 명시 필요** | simulate 상위10%/최대 컬럼 | price-engine |
| 4 | 관측 | **`settle_limit_orders` 예외 삼킴** — `exception when others` | **무결성은 안전**(주문단위 완전 롤백+pending 유지+재시도). 단 실패 원인이 로그에 안 남아 관측성 저하 | TEST N1: trades INSERT 강제오류 → 주문 pending·cash 복구·trade 0 | trade-integrity |

**부수 관측(누수 아님):** `admin_adjust_cash`의 `p_admin_id` 관리자 검증은 함수 내 부재(서비스롤/RLS·API 계층 의존) — 권한검증 위치 주의. 매도 수수료는 소각(sink)이라 자금 생성 불가.

---

## 상충·미수집 항목 (출처 병기)

- **미수집: 없음.** 세 검증관 리포트 3종 전부 수집.
- **상충: 없음(정합).** 세 검증관의 "브랜치 드리프트" 결론은 상충이 아니라 **독립 확증**(batch-tick 핵심발견 = trade-integrity E0). price-engine의 밸런스 절대수치(144틱 전제)와 batch-tick의 라이브(4320틱)는 **틱해상도 전제가 다를 뿐** 서로 부정하지 않는다 — 밸런스 결론은 "worktree-secure 엔진 전제 하 유효"로 조건 병기.
- **드리프트 조건 병기:** worktree-secure 단독 검증은 `supabase db reset`으로 자기 마이그만 재적용해야 세계 정합(현재 로컬 DB는 main 상태라 부적합). price-engine의 우상향 드리프트 "평균 normal>stable 역전"은 GBM Jensen 볼록성 결과이며 **설계 위반 아님**(중앙값은 stable>normal 정상).

---

## 재현 방법 요약

```bash
# 밸런스 분포 (price-engine)
npm run simulate -- --runs 2000            # 전략별 표시배수 = 값/1,000,000, 실배수 = ÷10

# 거래 무결성 (trade-integrity) — 로컬 DB, 전부 ROLLBACK
#   execute_trade p_at 오버라이드로 시각별 틱 체결가 실측 / dblink 2-백엔드 경합
#   지정가 밴드 [70000,130000] BAND_OUT / 하락틱 지정가 고정 체결

# 배치·틱 (batch-tick) — 로컬 DB
curl -X POST "localhost:3000/api/cron/daily-batch?date=YYYY-MM-DD" \
  -H "Authorization: Bearer $CRON_SECRET"
#   라이브 스키마에서 worktree-secure payload → ticksInserted:0 재현(브랜치 드리프트)

# 공정성 불변식 (직독)
#   supabase/migrations/20260712000000_auth_functions.sql  (claim_visit_bonus / signup_user)
#   supabase/migrations/20260718060000_attendance_streak.sql (claim_attendance_bonus)
#   supabase/migrations/20260717030000_capital_scale.sql   (초기자금 10M / visit_bonus 1M)
```

## 조치 권고 (우선순위)

1. **(배포 전 필수) worktree-secure → main 리베이스**로 배치·틱 개편 6~7종 흡수. 흡수 전 프로덕션/라이브 DB 배포 금지.
2. **(운영 공지) top-4 상금의 운 지배 성격 명시** — 상위권이 고분산 도박으로 갈릴 수 있음을 참가자에 고지(공정성 투명성).
3. **(관측성) `settle_limit_orders` 예외 삼킴에 로깅 추가** — 무결성 영향 없으나 실패 원인 추적용.
4. **(회귀) R2 pgnet timeout 마이그를 worktree-secure에도 포팅**(120000ms)하거나 main 리베이스로 흡수.

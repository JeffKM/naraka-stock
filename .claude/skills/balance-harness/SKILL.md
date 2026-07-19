---
name: balance-harness
description: 나라카 모의주식 밸런스/가격엔진 검증 에이전트 팀을 조율하는 오케스트레이터. "밸런스 검증", "가격 엔진 점검", "공정성 감사", "차익거래 있는지 확인", "시뮬 돌려서 밸런스 봐줘", "거래 무결성 검증", "배치/틱 점검" 요청 시 반드시 사용. 후속 작업: 밸런스 검증 다시 실행, 재검증, 업데이트, 특정 도메인(엔진/거래/배치/공정성)만 다시, 이전 감사 결과 기반 보완, 개장 전 최종 점검 시에도 반드시 이 스킬을 사용.
---

# Balance Harness — 밸런스 검증 오케스트레이터

나라카 모의주식의 가격 엔진·거래·배치·공정성을 4명의 검증관 팀으로 병렬 검증하고, **밸런스·공정성 감사 리포트**를 생성한다.

## 실행 모드: 에이전트 팀 (팬아웃/팬인)

상품이 걸린 이벤트라 도메인 간 발견 공유가 결과 품질을 좌우한다(엔진의 차익거래 → 거래 체결 재현 → 공정성 영향). 반드시 에이전트 팀으로 구성한다.

> **서브에이전트 폴백 (TeamCreate 미가용 시):** `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`이 세션 시작 시 미설정이면 이 세션엔 `TeamCreate`가 없다. 이때는 `Agent` 도구로 3개 도메인 검증관을 `run_in_background`로 병렬 스폰하고, **리더가 크로스 발견을 SendMessage로 중계**해 팀 협업을 근사한다. 서브에이전트는 런타임 규약상 최종 결과를 파일이 아니라 **텍스트로 반환**하므로, **리더가 반환 텍스트를 `_workspace/03_{name}_report.md`로 저장**해야 fairness-auditor가 Read할 수 있다(팬인 입력 보장). 진짜 팀 협업(팀원 간 직접 SendMessage)이 필요하면 플래그가 적용된 새 세션에서 실행한다.

## 에이전트 구성

| 팀원 | 에이전트 타입 | 역할 | 스킬 | 출력 |
|------|-------------|------|------|------|
| price-engine-verifier | (커스텀) | GBM·상하한·드리프트·시뮬 분포 | balance-verification | `_workspace/03_price-engine-verifier_report.md` |
| trade-integrity-verifier | (커스텀) | 거래 RPC·체결·수수료·잔고·조작방지 | balance-verification | `_workspace/03_trade-integrity-verifier_report.md` |
| batch-tick-verifier | (커스텀) | 배치·틱 생성·페이지네이션·pg_net | balance-verification | `_workspace/03_batch-tick-verifier_report.md` |
| fairness-auditor | (커스텀) | 공정성 불변식 + 경계면 교차검증 종합 | balance-verification | `docs/reports/balance-audit-{날짜}.md` |
| (리더 = 오케스트레이터) | — | 팀 조율·최종 보고 | balance-harness | — |

> 모든 팀원은 `model: "opus"`. fairness-auditor는 팬인 종합 담당이라 세 검증관이 유휴가 된 뒤 종합한다.

## 워크플로우

### Phase 0: 컨텍스트 확인 (후속 작업 지원)

1. `_workspace/` 존재 여부 확인.
2. 실행 모드 결정:
   - **미존재** → 초기 실행, Phase 1로.
   - **존재 + 부분 수정 요청**("엔진만 다시" 등) → 부분 재실행. 해당 검증관만 재호출, 이전 리포트를 프롬프트에 경로로 전달해 델타만 갱신. fairness-auditor는 항상 재종합.
   - **존재 + 새 입력(새 변경분)** → 기존 `_workspace/`를 `_workspace_{날짜시각}/`로 이동 후 Phase 1.

### Phase 1: 준비

1. 검증 범위 파악 — 무엇이 바뀌었나(엔진 파라미터 diff / 새 거래 RPC / 배치 로직 / 로스터 개편 등). `git diff`·최근 커밋으로 변경분 식별.
2. `_workspace/` 생성, 변경분 요약을 `_workspace/00_scope.md`에 저장.
3. 로컬 검증 환경 가용성 확인(선택): `npx supabase start` 기동 여부, `npm run simulate` 실행 가능 여부. 불가하면 각 검증관이 정적 검토로 폴백.

### Phase 2: 팀 구성

```
TeamCreate(team_name: "balance-team", members: [
  { name: "price-engine-verifier",   agent_type: "price-engine-verifier",   model: "opus", prompt: "balance-verification 스킬의 references/price-engine.md를 로드해 가격 엔진·시뮬 분포를 검증. 00_scope.md의 변경분 우선. 리포트를 _workspace/03_price-engine-verifier_report.md에 저장." },
  { name: "trade-integrity-verifier", agent_type: "trade-integrity-verifier", model: "opus", prompt: "references/trade-integrity.md 로드. 거래 RPC 무결성·조작방지 검증. _workspace/03_trade-integrity-verifier_report.md에 저장." },
  { name: "batch-tick-verifier",      agent_type: "batch-tick-verifier",      model: "opus", prompt: "references/batch-tick.md 로드. 배치·틱 생성 정합성 + 과거 장애 회귀 검증. _workspace/03_batch-tick-verifier_report.md에 저장." },
  { name: "fairness-auditor",         agent_type: "fairness-auditor",         model: "opus", prompt: "references/fairness-audit.md 로드. 세 검증관 리포트를 경계면 교차검증으로 종합. docs/reports/balance-audit-{날짜}.md 생성. 세 검증관 유휴 후 착수." }
])

TaskCreate(tasks: [
  { title: "가격 엔진·시뮬 검증",  assignee: "price-engine-verifier" },
  { title: "거래 무결성 검증",     assignee: "trade-integrity-verifier" },
  { title: "배치·틱 생성 검증",    assignee: "batch-tick-verifier" },
  { title: "공정성 감사·종합",     assignee: "fairness-auditor", depends_on: ["가격 엔진·시뮬 검증","거래 무결성 검증","배치·틱 생성 검증"] }
])
```

### Phase 3: 병렬 검증 (팀원 자체 조율)

- 세 도메인 검증관이 독립 검증하며, 교차 얽힘은 `SendMessage`로 실시간 공유:
  - price → trade: 차익거래 발견 시 체결 경로 재현 요청
  - trade → fairness: 조작 가능성·잔고 누수 알림
  - batch → price: 생성된 틱에서 밴드 준수 대조
- 각 검증관은 완료 시 리포트를 파일로 저장하고 리더에게 알린다.
- 리더는 `TaskGet`으로 진행률을 모니터링하고, 막힌 팀원에게 개입한다.

### Phase 4: 팬인 종합

1. 세 검증관 완료 대기(TaskGet).
2. fairness-auditor가 세 리포트를 Read → 경계면 교차검증 → `docs/reports/balance-audit-{날짜}.md` 생성.
3. 리더가 종합 리포트를 검토하고 공정성 판정(통과/조건부/위험)을 확인.

### Phase 5: 정리 및 보고

1. 팀원 종료 요청(SendMessage) → `TeamDelete`.
2. `_workspace/` 보존(감사 추적).
3. 사용자에게 요약 보고: 공정성 판정 + 심각도순 이슈 Top N + 재현 방법. Phase 7 피드백 기회 제공("팀 구성·검증 깊이 바꿀 점 있나요?").

## 데이터 흐름

```
[리더] → TeamCreate → 3 검증관(병렬) ←SendMessage→ 서로 발견 공유
                          │
                    03_*_report.md ×3
                          │
                          ↓ Read
                   [fairness-auditor 종합]
                          ↓
              docs/reports/balance-audit-{날짜}.md
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| 검증관 1명 실패 | 리더가 유휴 알림 감지 → SendMessage 상태 확인 → 재시작. 재실패 시 종합 리포트에 "해당 도메인 미수집" 명시 |
| 로컬 DB/시뮬 미가용 | 해당 검증관 정적 검토로 폴백, 리포트에 "동적 미검증" 표기 |
| 과반 실패 | 사용자에게 진행 여부 확인 |
| 검증관 간 상충 결론 | 삭제하지 않고 조건·출처 병기 |

## 테스트 시나리오

### 정상 흐름
1. 사용자: "밸런스 검증 돌려줘" (또는 엔진 파라미터 변경 후 "이 변경 밸런스 괜찮은지 봐줘")
2. Phase 1에서 `git diff`로 변경분 식별
3. Phase 2에서 balance-team 4명 + 4작업 구성
4. Phase 3에서 3검증관 병렬 검증, 차익거래 발견 시 상호 공유
5. Phase 4에서 fairness-auditor가 경계면 교차검증 종합
6. 결과: `docs/reports/balance-audit-{날짜}.md` + 공정성 판정

### 에러 흐름
1. Phase 3에서 trade-integrity-verifier가 로컬 DB 미기동으로 SQL 실행 실패
2. 1회 재시도(`npx supabase start`) 실패
3. 정적 검토로 폴백, 리포트에 "거래 동적 검증 미수행" 명시
4. fairness-auditor가 나머지로 종합, 종합 리포트에 한계 명시

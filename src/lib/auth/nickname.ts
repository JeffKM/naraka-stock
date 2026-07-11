// 닉네임 금칙어 필터 — 랭킹에 공개되므로 최소한의 필터를 건다 (PRD §7).
// 완전한 필터는 불가능하니 명백한 비속어·운영 사칭만 막고, 나머지는 어드민 정지로 대응한다.

const BANNED_WORDS = [
  // 비속어(대표형만 — 변형은 공백·특수문자 제거 후 부분 일치로 잡는다)
  "시발", "씨발", "씨빨", "시빨", "병신", "븅신", "지랄", "니미", "애미", "느금",
  "새끼", "쌔끼", "좆", "존나", "썅", "개년", "걸레", "창녀", "자지", "보지",
  "섹스", "야동", "딸딸이",
  // 운영·시스템 사칭
  "운영자", "관리자", "어드민", "admin", "나라카공식", "operator", "system",
];

// 특수문자·공백을 제거해 우회 입력(시.발, 시 발 등)도 걸러낸다
// 주의: \W는 한글도 지워버리므로 유니코드 속성 클래스로 "문자·숫자만 남긴다"
function normalize(nickname: string): string {
  return nickname.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isNicknameAllowed(nickname: string): boolean {
  const normalized = normalize(nickname);
  return !BANNED_WORDS.some((word) => normalized.includes(word.toLowerCase()));
}

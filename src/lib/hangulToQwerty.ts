import type { ChangeEvent, CompositionEvent } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

// 두벌식 표준 자판 기준 한글 → 영문 키 역변환
// 예: "비밀번호" → "qlalfqjsgh" (한/영 전환을 깜빡한 입력을 영문 타이핑으로 되돌린다)
const CHO = [
  "r", "R", "s", "e", "E", "f", "a", "q", "Q", "t",
  "T", "d", "w", "W", "c", "z", "x", "v", "g",
];
const JUNG = [
  "k", "o", "i", "O", "j", "p", "u", "P", "h", "hk",
  "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l",
];
const JONG = [
  "", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr",
  "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t",
  "T", "d", "w", "c", "z", "x", "v", "g",
];

// 완성형으로 조합되지 않은 낱자모 (호환 자모 U+3131~U+3163)
const JAMO: Record<string, string> = {
  "ㄱ": "r", "ㄲ": "R", "ㄳ": "rt", "ㄴ": "s", "ㄵ": "sw", "ㄶ": "sg",
  "ㄷ": "e", "ㄸ": "E", "ㄹ": "f", "ㄺ": "fr", "ㄻ": "fa", "ㄼ": "fq",
  "ㄽ": "ft", "ㄾ": "fx", "ㄿ": "fv", "ㅀ": "fg", "ㅁ": "a", "ㅂ": "q",
  "ㅃ": "Q", "ㅄ": "qt", "ㅅ": "t", "ㅆ": "T", "ㅇ": "d", "ㅈ": "w",
  "ㅉ": "W", "ㅊ": "c", "ㅋ": "z", "ㅌ": "x", "ㅍ": "v", "ㅎ": "g",
  "ㅏ": "k", "ㅐ": "o", "ㅑ": "i", "ㅒ": "O", "ㅓ": "j", "ㅔ": "p",
  "ㅕ": "u", "ㅖ": "P", "ㅗ": "h", "ㅘ": "hk", "ㅙ": "ho", "ㅚ": "hl",
  "ㅛ": "y", "ㅜ": "n", "ㅝ": "nj", "ㅞ": "np", "ㅟ": "nl", "ㅠ": "b",
  "ㅡ": "m", "ㅢ": "ml", "ㅣ": "l",
};

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

export function hangulToQwerty(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const idx = code - HANGUL_BASE;
      out += CHO[Math.floor(idx / 588)] + JUNG[Math.floor((idx % 588) / 28)] + JONG[idx % 28];
    } else {
      out += JAMO[ch] ?? ch;
    }
  }
  return out;
}

// react-hook-form register 결과에 한글→영문 자동 변환을 얹는다.
// IME 조합 중 값 교체가 무시되는 브라우저 대비로 compositionend에서 한 번 더 정리한다.
export function withHangulToQwerty(field: UseFormRegisterReturn) {
  const convert = (input: HTMLInputElement) => {
    const converted = hangulToQwerty(input.value);
    if (converted !== input.value) input.value = converted;
  };
  return {
    ...field,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      convert(e.target);
      return field.onChange(e);
    },
    onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      convert(input);
      void field.onChange({ target: input, type: "change" });
    },
  };
}

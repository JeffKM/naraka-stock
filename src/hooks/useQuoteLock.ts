"use client";

import { useEffect, useRef, useState } from "react";

type Moved = "none" | "favorable" | "adverse";

// 견적-잠금: 다이얼로그가 열릴 때 현재 틱값을 잠그고, 이후 변동을 유·불리로 판정.
// 유리(매수 하락/매도 상승)면 자동 반영, 불리(매수 상승/매도 하락)면 잠금 유지 + 재확인.
// open을 받는 이유: BuyDialog/SellDialog가 상시 마운트라 "열리는 순간"에 재잠금해야 한다.
//
// 구현 메모: 재잠금 effect(open false→true)와 유·불리 판정 effect는 둘 다 deps에 `open`을
// 포함하므로 같은 커밋에서 함께 실행될 수 있다. lockedPrice(state)만 갱신하고 lockedRef를
// 별도의 미러 effect로 "다음 렌더"에 동기화하면, 판정 effect가 아직 갱신되지 않은 stale
// lockedRef를 같은 커밋에서 읽어버리는 경쟁이 생긴다(재오픈 직후 moved가 잘못 "favorable"로
// 판정됨). 따라서 lockedPrice를 설정하는 모든 지점에서 lockedRef.current도 "동기적으로"
// 함께 갱신한다 — effect 콜백/이벤트 핸들러 내부의 ref mutate는 렌더 중이 아니므로
// react-hooks/refs에 걸리지 않는다. 판정 effect는 lockedRef만 읽고 lockedPrice를 의존성에
// 넣지 않으므로 react-hooks/set-state-in-effect의 캐스케이딩 렌더 경고도 발생하지 않는다.
export function useQuoteLock(currentPrice: number, side: "buy" | "sell", open: boolean) {
  const [lockedPrice, setLockedPrice] = useState(currentPrice);
  const [moved, setMoved] = useState<Moved>("none");
  const prevOpen = useRef(open);
  const lockedRef = useRef(currentPrice);

  // 다이얼로그가 닫힘→열림으로 전환될 때 현재가로 재잠금
  useEffect(() => {
    if (open && !prevOpen.current) {
      lockedRef.current = currentPrice;
      setLockedPrice(currentPrice);
      setMoved("none");
    }
    prevOpen.current = open;
  }, [open, currentPrice]);

  // 열려 있는 동안 현재가 변동을 유·불리로 판정
  useEffect(() => {
    const locked = lockedRef.current;
    if (!open || currentPrice <= 0 || locked <= 0 || currentPrice === locked) return;
    const favorable = side === "buy" ? currentPrice < locked : currentPrice > locked;
    if (favorable) {
      lockedRef.current = currentPrice; // 유리 → 자동 반영
      setLockedPrice(currentPrice);
      setMoved("favorable");
    } else {
      setMoved("adverse"); // 불리 → 잠금 유지, 재확인 필요
    }
  }, [open, currentPrice, side]);

  function relock() {
    lockedRef.current = currentPrice;
    setLockedPrice(currentPrice);
    setMoved("none");
  }

  return { lockedPrice, moved, relock };
}

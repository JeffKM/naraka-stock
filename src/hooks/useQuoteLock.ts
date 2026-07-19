"use client";

import { useEffect, useRef, useState } from "react";

type Moved = "none" | "favorable" | "adverse";

// 견적-잠금: 다이얼로그가 열릴 때 현재 틱값을 잠그고, 이후 변동을 유·불리로 판정.
// 유리(매수 하락/매도 상승)면 자동 반영, 불리(매수 상승/매도 하락)면 잠금 유지 + 재확인.
// open을 받는 이유: BuyDialog/SellDialog가 상시 마운트라 "열리는 순간"에 재잠금해야 한다.
//
// 구현 메모: "유·불리 판정" effect가 자신이 갱신하는 lockedPrice를 의존성 배열에 다시
// 넣으면 react-hooks/set-state-in-effect(캐스케이딩 렌더 경고)에 걸린다. 그렇다고 렌더 중에
// ref를 mutate하면 react-hooks/refs("Cannot access refs during render")에 걸린다.
// 따라서 lockedPrice → lockedRef 동기화를 별도 effect로 분리해 "렌더 이후에만" ref를 갱신하고,
// 판정 effect는 그 ref를 읽기만 해서 자기 자신을 의존성으로 물지 않도록 한다.
export function useQuoteLock(currentPrice: number, side: "buy" | "sell", open: boolean) {
  const [lockedPrice, setLockedPrice] = useState(currentPrice);
  const [moved, setMoved] = useState<Moved>("none");
  const prevOpen = useRef(open);
  const lockedRef = useRef(currentPrice);

  // lockedPrice state를 ref로 미러링 (effect 안에서만 mutate)
  useEffect(() => {
    lockedRef.current = lockedPrice;
  }, [lockedPrice]);

  // 다이얼로그가 닫힘→열림으로 전환될 때 현재가로 재잠금
  useEffect(() => {
    if (open && !prevOpen.current) {
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
      setLockedPrice(currentPrice); // 유리 → 자동 반영
      setMoved("favorable");
    } else {
      setMoved("adverse"); // 불리 → 잠금 유지, 재확인 필요
    }
  }, [open, currentPrice, side]);

  function relock() {
    setLockedPrice(currentPrice);
    setMoved("none");
  }

  return { lockedPrice, moved, relock };
}

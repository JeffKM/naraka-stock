"use client";

import { useEffect, useRef } from "react";

// "아기자기한 지옥" 분위기 레이어 (무드: 보라밤) — MarketGridBackdrop 위에 얹는 순수 장식.
// 불씨(canvas 발광 블렌드로 아래→위 부유) + 안개(하단 radial 블롭, screen 블렌드) 2겹.
// aria-hidden·pointer-events-none이며 실제 데이터와 무관하다.
//
// 가독성 설계 — "중앙 dim / 사이드 살림" 마스크:
//   콘텐츠 밴드(512px) 뒤에서는 감쇠, 데스크톱 빈 사이드에서는 살아난다.
//   모바일(풀폭)에선 밴드가 화면보다 넓어 전역이 잠잠해진다.
// 성능 — DPR≤2, prefers-reduced-motion에서 부유 정지(정적 1프레임).

// 확정 토큰 (docs/RESEARCH-ui-redesign.md §4 Phase C)
const EMBER_DENSITY = 70; // 불씨 밀도 기준값 (1280x800 기준 개수)
const EMBER_COLOR = "214, 150, 255"; // 불씨 본체 rgb
const EMBER_CORE = "240, 214, 255"; // 불씨 코어 rgb

interface Ember {
  x: number;
  y: number;
  r: number; // 반지름(px, DPR 적용 전)
  vy: number; // 상승 속도(px/s)
  drift: number; // 좌우 흔들림 진폭(px)
  phase: number; // 흔들림 위상
  freq: number; // 흔들림 주기(rad/s)
  life: number; // 0~1 진행도 (깜빡임용)
  ttl: number; // 수명(s)
  base: number; // 기본 밝기 0~1
}

export function HellAtmosphereLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let embers: Ember[] = [];
    let raf = 0;
    let last = 0;

    const spawn = (initial: boolean): Ember => {
      const r = 0.8 + Math.random() * 1.9;
      return {
        x: Math.random() * width,
        // 최초 프레임은 화면 전체에 흩뿌리고, 이후 재생성은 하단에서 올라온다
        y: initial ? Math.random() * height : height + Math.random() * 40,
        r,
        vy: 8 + Math.random() * 20,
        drift: 6 + Math.random() * 18,
        phase: Math.random() * Math.PI * 2,
        freq: 0.3 + Math.random() * 0.7,
        life: 0,
        ttl: 6 + Math.random() * 8,
        base: 0.35 + Math.random() * 0.5,
      };
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 밀도를 뷰포트 면적에 비례시키되 과밀/과소를 제한
      const count = Math.max(
        28,
        Math.min(130, Math.round((EMBER_DENSITY * (width * height)) / (1280 * 800))),
      );
      embers = Array.from({ length: count }, () => spawn(true));
    };

    const drawEmber = (e: Ember, alpha: number) => {
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 3);
      g.addColorStop(0, `rgba(${EMBER_CORE}, ${alpha})`);
      g.addColorStop(0.35, `rgba(${EMBER_COLOR}, ${alpha * 0.75})`);
      g.addColorStop(1, `rgba(${EMBER_COLOR}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * 3, 0, Math.PI * 2);
      ctx.fill();
    };

    const renderStatic = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      for (const e of embers) drawEmber(e, e.base * 0.6);
      ctx.globalCompositeOperation = "source-over";
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      for (const e of embers) {
        e.life += dt / e.ttl;
        e.y -= e.vy * dt;
        e.phase += e.freq * dt;
        const x = e.x + Math.sin(e.phase) * e.drift;

        if (e.life >= 1 || e.y < -10) {
          Object.assign(e, spawn(false));
          continue;
        }

        // 페이드 인/아웃 + 미세 깜빡임
        const fade =
          e.life < 0.15
            ? e.life / 0.15
            : e.life > 0.7
              ? (1 - e.life) / 0.3
              : 1;
        const flicker = 0.82 + 0.18 * Math.sin(e.phase * 3.1);
        drawEmber({ ...e, x }, e.base * fade * flicker);
      }

      ctx.globalCompositeOperation = "source-over";
      raf = window.requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener("resize", resize);

    if (reduceMotion) {
      renderStatic();
    } else {
      last = performance.now();
      raf = window.requestAnimationFrame(tick);
    }

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="hell-atmosphere pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* 안개 — 하단 3블롭, screen 블렌드로 다크 위에서 은은히 피어오른다 */}
      <div className="hell-fog hell-fog-a" />
      <div className="hell-fog hell-fog-b" />
      <div className="hell-fog hell-fog-c" />
      {/* 불씨 — canvas 발광 블렌드 */}
      <canvas ref={canvasRef} className="hell-embers absolute inset-0" />
    </div>
  );
}

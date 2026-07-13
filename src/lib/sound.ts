"use client";

import { useSettingsStore } from "@/lib/settingsStore";

// WebAudio 기반 효과음 — 오디오 파일 없이 짧은 신스음을 합성한다.
// 볼륨은 설정 스토어(0~100)를 따르고, 0이면 아예 재생하지 않는다.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) ctx = new AudioContext();
    // 사용자 제스처 전에 생성되면 suspended 상태일 수 있다
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface Note {
  freq: number; // 주파수 (Hz)
  at: number; // 시작 오프셋 (초)
  dur: number; // 길이 (초)
  type?: OscillatorType;
}

function playNotes(notes: Note[]) {
  const volume = useSettingsStore.getState().volume;
  if (volume <= 0) return;
  const audio = getContext();
  if (!audio) return;

  const master = audio.createGain();
  // 최대 볼륨에서도 과하지 않게 0.25로 캡
  master.gain.value = (volume / 100) * 0.25;
  master.connect(audio.destination);

  const now = audio.currentTime;
  for (const note of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = note.type ?? "sine";
    osc.frequency.value = note.freq;
    // 클릭 노이즈 방지용 짧은 어택 + 자연스러운 릴리즈
    gain.gain.setValueAtTime(0, now + note.at);
    gain.gain.linearRampToValueAtTime(1, now + note.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + note.at + note.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + note.at);
    osc.stop(now + note.at + note.dur + 0.05);
  }
}

// 체결 성공: 밝게 올라가는 두 음
export function playTradeSound() {
  playNotes([
    { freq: 659.25, at: 0, dur: 0.12, type: "triangle" },
    { freq: 987.77, at: 0.09, dur: 0.22, type: "triangle" },
  ]);
}

// 보유 종목 변동 알림: 딩-동 두 음
export function playAlertSound() {
  playNotes([
    { freq: 880, at: 0, dur: 0.18 },
    { freq: 659.25, at: 0.16, dur: 0.3 },
  ]);
}

// 볼륨 조절 미리듣기: 단음
export function playPreviewSound() {
  playNotes([{ freq: 783.99, at: 0, dur: 0.18, type: "triangle" }]);
}

// Scan and floor feedback: beeps, input flashes, loud floor tones and the
// alertToast wrapper. Kept out of the ui-shared kit so the login screen and
// other eager code can use it without downloading the whole kit.
import { toast } from "sonner";

import { getFloorAudioContext } from "@/lib/audio-unlock";

// ---------------------------------------------------------------------------
// Barcode scanner helpers
// ---------------------------------------------------------------------------

/** Play a short, pleasant confirmation beep via Web Audio API (works on iOS/Android too). */
export function playBarcodeBeep() {
  try {
    const ctx = new (window.AudioContext ?? (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(1480, ctx.currentTime);          // E6 — bright & pleasant
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.06); // quick upward chirp
    gain.gain.setValueAtTime(0.9, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close();
  } catch {
    // Audio not available — silent fallback
  }
}

/**
 * Flash an input element with a colour highlight for scanner feedback.
 * colour: "orange" = next-field cue, "blue" = confirmed-field cue,
 * "green" = matched, "yellow" = look here, "red" = rejected scan.
 */
const FLASH_CLASSES: Record<"orange" | "blue" | "red" | "green" | "yellow", string[]> = {
  orange: ["ring-2", "ring-orange-400", "ring-offset-1"],
  blue: ["ring-2", "ring-blue-400", "ring-offset-1"],
  red: ["ring-2", "ring-red-500", "ring-offset-1", "animate-pulse"],
  green: ["ring-2", "ring-green-500", "ring-offset-1"],
  yellow: ["ring-2", "ring-yellow-300", "ring-offset-1", "animate-pulse"],
};

export function flashInput(el: HTMLElement | null, colour: keyof typeof FLASH_CLASSES) {
  if (!el) return;
  const cls = FLASH_CLASSES[colour];
  el.classList.add(...cls);
  setTimeout(() => el.classList.remove(...cls), colour === "red" ? 1400 : 700);
}

// ---------------------------------------------------------------------------
// Floor alert sounds — loud, distinct tones for noisy warehouse-floor work
// (put-away, picking, moves, transfers, cycle counts). Synthesized via Web
// Audio so there are no audio files to bundle or load.
// ---------------------------------------------------------------------------

// The context itself lives in src/lib/audio-unlock.ts, which also owns the
// first-gesture primer. Before that existed every caller here ran inside a
// click or a scan, so a suspended context never showed up; the pick ticket
// ring fires from a push message instead and would have been silent.
function getFloorAlertCtx(): AudioContext | null {
  return getFloorAudioContext();
}

function playFloorTone(freq: number, duration: number, opts: { type?: OscillatorType; volume?: number; delay?: number } = {}) {
  const { type = "square", volume = 1.0, delay = 0 } = opts;
  try {
    const ctx = getFloorAlertCtx();
    if (!ctx) return;
    const startTime = ctx.currentTime + delay;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, startTime);
    compressor.knee.setValueAtTime(10, startTime);
    compressor.ratio.setValueAtTime(12, startTime);
    compressor.attack.setValueAtTime(0.002, startTime);
    compressor.release.setValueAtTime(0.1, startTime);
    compressor.connect(ctx.destination);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    gain.gain.setValueAtTime(volume, startTime + duration - 0.03);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    gain.connect(compressor);

    const osc1 = ctx.createOscillator();
    osc1.type = type;
    osc1.frequency.setValueAtTime(freq, startTime);
    osc1.connect(gain);
    osc1.start(startTime);
    osc1.stop(startTime + duration);

    // Octave-up harmonic layered in at reduced volume for cut-through brightness.
    const osc2 = ctx.createOscillator();
    osc2.type = type;
    osc2.frequency.setValueAtTime(freq * 2, startTime);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(volume * 0.4, startTime);
    gain2.gain.setValueAtTime(volume * 0.4, startTime + duration - 0.03);
    gain2.gain.linearRampToValueAtTime(0, startTime + duration);
    osc2.connect(gain2);
    gain2.connect(compressor);
    osc2.start(startTime);
    osc2.stop(startTime + duration);
  } catch {
    // Audio not available — silent fallback
  }
}

let floorFlashEl: HTMLDivElement | null = null;

function flashScreen(color: string) {
  if (typeof document === "undefined") return;
  if (!floorFlashEl) {
    floorFlashEl = document.createElement("div");
    floorFlashEl.style.position = "fixed";
    floorFlashEl.style.inset = "0";
    floorFlashEl.style.pointerEvents = "none";
    floorFlashEl.style.zIndex = "9999";
    floorFlashEl.style.opacity = "0";
    floorFlashEl.style.transition = "opacity 0.15s ease-out";
    document.body.appendChild(floorFlashEl);
  }
  const el = floorFlashEl;
  el.style.background = color;
  el.style.transition = "none";
  el.style.opacity = "0.85";
  requestAnimationFrame(() => {
    el.style.transition = "opacity 0.15s ease-out";
    el.style.opacity = "0";
  });
}

function floorVibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration not supported — ignore
  }
}

/** Positive confirmation — task confirmed/completed. Pleasant two-note rise, no flash/vibrate. */
export function playConfirmTone() {
  playFloorTone(880, 0.12, { type: "sine", volume: 0.9 });
  playFloorTone(1318, 0.18, { type: "sine", volume: 0.9, delay: 0.11 });
}

/** Needs attention — non-blocking issue the user should notice (short pick, cancellation, rule violation). */
export function playAttentionTone() {
  for (let i = 0; i < 2; i++) {
    const base = i * 0.4;
    playFloorTone(660, 0.15, { type: "sawtooth", volume: 1.0, delay: base });
    playFloorTone(654, 0.15, { type: "sawtooth", volume: 0.7, delay: base });
    playFloorTone(440, 0.15, { type: "sawtooth", volume: 1.0, delay: base + 0.18 });
    playFloorTone(436, 0.15, { type: "sawtooth", volume: 0.7, delay: base + 0.18 });
  }
  flashScreen("rgba(217,119,6,0.5)");
  floorVibrate([150, 80, 150]);
}

/**
 * A pick ticket was released. Three bell strikes about 1.4s apart, so it
 * carries across a noisy floor from whatever page the operator is on.
 *
 * A perfect fifth (C6 -> G6) on sine waves, which reads as a doorbell rather
 * than an alarm; playFloorTone still layers an octave harmonic and a
 * compressor over it for cut-through. Deliberately no flashScreen: unlike
 * playAttentionTone this can fire while someone is mid-scan on another
 * screen, and stealing the whole display there would be hostile.
 *
 * Only audible with the context primed - see isFloorAudioPrimed(). A service
 * worker has no AudioContext, so with the app fully closed the OS plays its
 * own notification sound instead and this never runs.
 */
export function playPickTicketRing() {
  for (let strike = 0; strike < 3; strike += 1) {
    const at = strike * 1.4;
    playFloorTone(1046.5, 0.22, { type: "sine", volume: 0.85, delay: at });
    playFloorTone(1568.0, 0.42, { type: "sine", volume: 0.7, delay: at + 0.16 });
  }
  floorVibrate([120, 90, 120, 90, 120]);
}

/** No-go — blocking failure that stops the task (scan mismatch, confirm failed). Loudest, rapid-fire. */
export function playNoGoTone() {
  for (let i = 0; i < 4; i++) {
    playFloorTone(1000, 0.18, { type: "sawtooth", volume: 1.0, delay: i * 0.22 });
  }
  flashScreen("rgba(220,38,38,0.6)");
  floorVibrate([200, 100, 200, 100, 200]);
}

/**
 * Toast helpers for noisy floor workflows (put-away, picking, moves, transfers,
 * cycle counts, returning drafts to receiving). Pairs the existing toast with a
 * loud tone so the outcome is audible over warehouse floor noise.
 */
export const alertToast = {
  success: (message: string, opts?: Parameters<typeof toast.success>[1]) => {
    playConfirmTone();
    return toast.success(message, opts);
  },
  attention: (message: string, opts?: Parameters<typeof toast.warning>[1]) => {
    playAttentionTone();
    return toast.warning(message, opts);
  },
  noGo: (message: string, opts?: Parameters<typeof toast.error>[1]) => {
    playNoGoTone();
    return toast.error(message, opts);
  },
};

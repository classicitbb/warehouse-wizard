/**
 * Shared AudioContext for floor alert sounds, plus the gesture primer that
 * makes them audible when nothing was clicked.
 *
 * WHY THIS EXISTS
 * Every floor sound used to run from inside a click or a scan handler, so the
 * context was already running and nobody noticed that getFloorAlertCtx() calls
 * resume() without awaiting it. Autoplay policy rejects resume() outside a user
 * gesture, so a sound triggered by a push message or a poll — which is exactly
 * what the pick ticket ring is — would schedule its oscillators into a
 * suspended context and be silently dropped.
 *
 * The fix is to prime the context during the first real gesture of the session
 * and keep it alive afterwards.
 */

let floorAlertCtx: AudioContext | null = null;
let primed = false;
let primerInstalled = false;

const PRIMED_SESSION_KEY = "warehouseWizard.audio.primed";

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ?? null;
}

/**
 * The one AudioContext for floor alerts. Returns null where Web Audio is
 * unavailable (jsdom in tests, locked-down webviews) so callers can no-op.
 */
export function getFloorAudioContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  if (!floorAlertCtx) {
    try {
      floorAlertCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (floorAlertCtx.state === "suspended") {
    // Resolves only inside a gesture; elsewhere it rejects and we stay primed:false.
    void floorAlertCtx.resume().catch(() => undefined);
  }
  return floorAlertCtx;
}

/**
 * Whether a sound started right now would actually be heard. Callers that fire
 * without a gesture should check this and fall back to the OS notification
 * rather than pretending they made a noise.
 */
export function isFloorAudioPrimed(): boolean {
  if (primed) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(PRIMED_SESSION_KEY) === "1" && floorAlertCtx?.state === "running";
  } catch {
    return false;
  }
}

async function prime(): Promise<void> {
  const ctx = getFloorAudioContext();
  if (!ctx) return;
  try {
    await ctx.resume();
    // Resuming alone is not enough on some engines: a node has to actually
    // start inside the gesture before the context is treated as unblocked.
    // Near-silent and 10ms long, so nobody hears the priming itself.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.01);
    primed = true;
    try {
      window.sessionStorage.setItem(PRIMED_SESSION_KEY, "1");
    } catch {
      // Storage unavailable — the in-memory flag still covers this session.
    }
  } catch {
    // Not a real gesture after all; the next one will try again.
    primed = false;
  }
}

/**
 * Prime on the first gesture of the session, and re-prime when the tab comes
 * back to the foreground.
 *
 * Mounted from src/main.tsx rather than the app shell: the shell is lazy, and
 * the first gesture of a session is usually the login button, which happens
 * before the shell exists. Chrome also suspends contexts in backgrounded tabs,
 * which is precisely the state a background ring has to survive.
 */
export function installFloorAudioPrimer(): void {
  if (primerInstalled || typeof window === "undefined") return;
  primerInstalled = true;

  const onGesture = () => {
    void prime();
  };

  // capture + passive so this never interferes with scan handlers, and `once`
  // so a primed session costs nothing thereafter.
  for (const type of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(type, onGesture, { once: true, capture: true, passive: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (floorAlertCtx && floorAlertCtx.state === "suspended") void prime();
  });
}

/** Test seam: drop the singleton so a fresh context is built next time. */
export function resetFloorAudioForTests(): void {
  floorAlertCtx = null;
  primed = false;
  primerInstalled = false;
}

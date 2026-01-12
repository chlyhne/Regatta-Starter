import {
  state,
  BEEP_FREQUENCY,
  START_BEEP_FREQUENCY,
  LONG_BEEP_DURATION_MS,
  BEEP_DURATION_MS,
  START_BEEP_DURATION_MS,
} from "./state.js";

function initAudio() {
  if (state.audio.ctx) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  state.audio.ctx = new AudioContext();
  if (state.audio.ctx.state === "suspended") {
    state.audio.ctx.resume().catch(() => {});
  }
}

export function unlockAudio() {
  initAudio();
  if (!state.audio.ctx) return;
  if (state.audio.ctx.state === "suspended") {
    state.audio.ctx.resume().catch(() => {});
  }
  if (state.audio.unlocked) return;
  const ctx = state.audio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  osc.start(now);
  osc.stop(now + 0.02);
  state.audio.unlocked = true;
}

function ensureAudio() {
  if (!state.audio.ctx || state.audio.ctx.state === "closed") {
    state.audio.ctx = null;
    initAudio();
  }
  if (state.audio.ctx && state.audio.ctx.state === "suspended") {
    state.audio.ctx.resume().catch(() => {});
  }
}

export function playBeep(durationMs = BEEP_DURATION_MS, frequency = BEEP_FREQUENCY) {
  if (!state.soundEnabled) return;
  ensureAudio();
  if (!state.audio.ctx) return;
  const ctx = state.audio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = frequency;
  gain.gain.value = 0.12;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
  gain.gain.linearRampToValueAtTime(0.0, now + durationMs / 1000);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.01);
}

export function handleCountdownBeeps(deltaSeconds) {
  if (!document.body.classList.contains("race-mode")) {
    state.audio.lastBeepSecond = null;
    state.audio.milestoneArmed = null;
    return;
  }
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    state.audio.lastBeepSecond = null;
    state.audio.milestoneArmed = null;
    return;
  }
  const remaining = Math.floor(deltaSeconds);
  if (!state.audio.milestoneArmed) {
    state.audio.milestoneArmed = {
      300: false,
      240: false,
      60: false,
    };
  }
  [300, 240, 60].forEach((milestone) => {
    if (remaining > milestone) {
      state.audio.milestoneArmed[milestone] = true;
      return;
    }
    if (state.audio.milestoneArmed[milestone]) {
      playBeep(milestone === 60 ? LONG_BEEP_DURATION_MS : BEEP_DURATION_MS);
      state.audio.milestoneArmed[milestone] = false;
    }
  });
  if (remaining > 10) {
    state.audio.lastBeepSecond = null;
    return;
  }
  if (remaining === 0) {
    if (!state.audio.startBeeped) {
      playBeep(START_BEEP_DURATION_MS, START_BEEP_FREQUENCY);
      state.audio.startBeeped = true;
    }
    state.audio.lastBeepSecond = remaining;
    return;
  }
  if (remaining === state.audio.lastBeepSecond) return;
  state.audio.lastBeepSecond = remaining;
  playBeep();
}

export function resetBeepState() {
  state.audio.lastBeepSecond = null;
  state.audio.milestoneArmed = null;
  state.audio.startBeeped = false;
}

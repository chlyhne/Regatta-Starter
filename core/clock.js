import { state } from "./state.js";

function getNowMs() {
  if (state.replay && state.replay.active && Number.isFinite(state.replay.clockNow)) {
    return state.replay.clockNow;
  }
  return Date.now();
}

export { getNowMs };

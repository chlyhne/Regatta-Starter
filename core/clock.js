import { state } from "./state.js";
import { getReplayClockNow } from "./replay.js";

function getNowMs() {
  const replayNow = getReplayClockNow();
  if (Number.isFinite(replayNow)) {
    return replayNow;
  }
  return Date.now();
}

export { getNowMs };

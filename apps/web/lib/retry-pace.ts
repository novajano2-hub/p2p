/*
  How often a screen that failed to load asks again by itself.

  A load fails for reasons that mend without anybody: a server restarting, a
  deploy, a phone between networks. Until this existed every such failure sat
  on the screen until its "Try again" was pressed, and pressed again if the
  server was not back yet. Now the screen asks again by itself - often at
  first, because most of what goes wrong is over within seconds and the
  screen should be back within a few seconds of the server, then less and
  less often, so a server that stays down is not hammered by every open tab:
  seven requests in the first minute, two a minute after that.

  The pace is shared by everything on the page, on purpose. A retry flips its
  screen back to "loading", and if that fails the screen mounts a fresh error -
  which would start a fresh count, and ask every three seconds for ever. Kept
  here, the count survives that, and three failed panels on one page climb
  the steps together rather than three times as fast.
*/

const STEPS_MS = [2_000, 3_000, 5_000, 8_000, 13_000, 20_000, 30_000] as const;
/** Retries this close together are one round: several panels that failed together. */
const ONE_ROUND_MS = 1_000;
/** This long without a retry, and whatever was wrong is taken to have passed. */
const FORGOTTEN_AFTER_MS = 60_000;

let step = 0;
let lastAt = 0;

/** How long to wait before asking again. A little uneven, so tabs do not ask in step. */
export function retryDelay(now: number, roll: number = Math.random()): number {
  if (now - lastAt > FORGOTTEN_AFTER_MS) step = 0;
  const base = STEPS_MS[Math.min(step, STEPS_MS.length - 1)] ?? 30_000;
  return Math.floor(base * (0.85 + roll * 0.3));
}

/** An automatic retry was just made. */
export function noteRetry(now: number): void {
  if (now - lastAt > ONE_ROUND_MS) step += 1;
  lastAt = now;
}

/** For tests: as if nothing had ever failed. */
export function resetRetryPace(): void {
  step = 0;
  lastAt = 0;
}

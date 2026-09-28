// How fast the world runs. Slow is the default: a first-time visitor should be able to watch a
// body form, a mind think and an answer land, one thing at a time.

export type Speed = 'pause' | 'slow' | 'normal' | 'fast'
export const SPEEDS: Speed[] = ['pause', 'slow', 'normal', 'fast']
export const DEFAULT_SPEED: Speed = 'slow'

export interface Pace {
  /** Physics frames per second (the display still redraws at screen rate). */
  stepsPerSecond: number
  /** At most one new thought per gapMs, all minds together. */
  gapMs: number
  /** Demo minds pretend to think this long, so you can see who is thinking. */
  demoLatencyMs: number
}

export const PACES: Record<Speed, Pace> = {
  pause: { stepsPerSecond: 0, gapMs: Infinity, demoLatencyMs: 0 },
  slow: { stepsPerSecond: 7, gapMs: 8000, demoLatencyMs: 1500 },
  normal: { stepsPerSecond: 20, gapMs: 4000, demoLatencyMs: 800 },
  // Fast keeps the paid-call ceiling of the original turn-taking (one thought per 3 s).
  fast: { stepsPerSecond: 60, gapMs: 3000, demoLatencyMs: 300 },
}

export const parseSpeed = (s: string | null | undefined): Speed => (SPEEDS.includes(s as Speed) ? (s as Speed) : DEFAULT_SPEED)

/** Physics frames to run for dtMs of wall time, with an accumulator carried between calls.
 *  Capped so a background tab coming back does not run a burst of hundreds of frames. */
export function stepsDue(acc: number, dtMs: number, stepsPerSecond: number, maxSteps = 4): { steps: number; acc: number } {
  if (stepsPerSecond <= 0) return { steps: 0, acc: 0 }
  const total = acc + (Math.max(0, dtMs) * stepsPerSecond) / 1000
  const steps = Math.min(maxSteps, Math.floor(total))
  return { steps, acc: steps === maxSteps ? 0 : total - steps }
}

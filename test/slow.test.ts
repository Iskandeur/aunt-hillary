import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIFE, createWorld, mulberry32, paint } from '../src/engine/world.ts'
import { activeMinds, createColony, divideOversized, updateOrganisms } from '../src/engine/organisms.ts'
import { adoptedWords, describeRule, newRules } from '../src/engine/feed.ts'
import { DEFAULT_SPEED, PACES, parseSpeed, stepsDue } from '../src/engine/pace.ts'
import { createSim, frame, think } from '../src/engine/sim.ts'

test('slow is the default and runs physics at a few steps per second', () => {
  assert.equal(DEFAULT_SPEED, 'slow')
  assert.equal(parseSpeed(null), 'slow')
  assert.equal(parseSpeed('warp'), 'slow')
  assert.equal(parseSpeed('fast'), 'fast')
  // One second of 60 Hz frames at slow speed: 7 physics steps, not 60.
  let acc = 0, steps = 0
  for (let k = 0; k < 60; k++) {
    const r = stepsDue(acc, 1000 / 60, PACES.slow.stepsPerSecond)
    acc = r.acc
    steps += r.steps
  }
  assert.ok(steps >= 6 && steps <= 8, `slow ran ${steps} steps in 1 s`)
  assert.equal(stepsDue(0, 1000, PACES.pause.stepsPerSecond).steps, 0)
  // A tab coming back after a minute does not run a burst.
  assert.equal(stepsDue(0, 60_000, PACES.fast.stepsPerSecond).steps, 4)
})

test('the thought gap follows the speed: slower speed, rarer thoughts', () => {
  assert.ok(PACES.slow.gapMs >= 8000)
  assert.ok(PACES.slow.gapMs > PACES.normal.gapMs && PACES.normal.gapMs >= PACES.fast.gapMs)
  assert.ok(PACES.fast.gapMs >= 3000, 'fast must not raise the paid-call ceiling')
})

test('demo minds take turns at the slow gap and show who is thinking', () => {
  const sim = createSim(3)
  for (let k = 0; k < 20; k++) frame(sim)
  assert.ok(activeMinds(sim.colony).length >= 3)
  const { gapMs, demoLatencyMs } = PACES.slow
  let delivered = 0, sawThinking = false
  const before = sim.thoughts.length
  for (let t = 0; t <= 60_000; t += 100) {
    think(sim, t, 5000, gapMs, { demoGapMs: gapMs, demoLatencyMs })
    if (activeMinds(sim.colony).some((o) => o.thinking)) sawThinking = true
    assert.ok(activeMinds(sim.colony).filter((o) => o.thinking).length <= 1)
  }
  delivered = sim.thoughts.length - before
  assert.ok(sawThinking)
  // 60 s at one thought per 8 s: 7 or 8 thoughts, not one per mind every 5 s (~96).
  assert.ok(delivered >= 6 && delivered <= 8, `got ${delivered} thoughts`)
  const withBubble = [...sim.colony.orgs.values()].filter((o) => o.bubble)
  assert.ok(withBubble.length > 0 && withBubble.every((o) => o.bubbleUntil > 0))
})

test('the feed tells births, splits, fusions and dissolutions in plain sentences', () => {
  const wd = createWorld(64, 40, mulberry32(1))
  const col = createColony()
  paint(wd, 8, 8, 3, LIFE)
  paint(wd, 20, 8, 3, LIFE)
  updateOrganisms(wd, col)
  for (const o of col.orgs.values()) o.fusion = 'accept'
  const births = col.feed.events.filter((e) => e.kind === 'born')
  assert.equal(births.length, 2)
  assert.match(births[0].text, /^\d+ cells fused into body #\d+$/)
  for (let x = 8; x <= 20; x++) wd.cells[8 * 64 + x] = LIFE // bridge: fusion
  updateOrganisms(wd, col)
  updateOrganisms(wd, col) // loose bridge cells join one body first, then the bodies touch
  const merged = col.feed.events.find((e) => e.kind === 'merged')!
  assert.match(merged.text, /^#\d+ was absorbed by #\d+$/)
  assert.equal(col.orgs.get(merged.id)!.alive, true, 'a click selects the survivor')
  // Grow one big body and cut it.
  for (let y = 20; y < 30; y++) for (let x = 30; x < 50; x++) wd.cells[y * 64 + x] = LIFE
  updateOrganisms(wd, col)
  divideOversized(wd, col)
  updateOrganisms(wd, col)
  const split = col.feed.events.find((e) => e.kind === 'divided')!
  assert.match(split.text, /^#\d+ split into #\d+ and #\d+; they keep its memory$/)
  // Erase the fused body: it dissolves.
  for (let y = 0; y < 20; y++) for (let x = 0; x < 30; x++) wd.cells[y * 64 + x] = 0
  updateOrganisms(wd, col)
  assert.ok(col.feed.events.some((e) => e.kind === 'dissolved' && /fell apart/.test(e.text)))
  const ns = col.feed.events.map((e) => e.n)
  assert.deepEqual(ns, [...ns].sort((a, b) => a - b))
})

test('births learn whether they got a mind once minds are re-ranked', () => {
  const sim = createSim(3)
  for (let k = 0; k < 20; k++) frame(sim)
  const births = sim.colony.feed.events.filter((e) => e.kind === 'born')
  assert.ok(births.length > 0)
  assert.ok(births.every((e) => e.settled && /has a mind|too small to think/.test(e.text)))
})

test('rules and adopted words read as plain English', () => {
  const eat = { self: 'life' as const, dir: 'any' as const, neighbor: 'plant' as const, toSelf: 'life' as const, toNeighbor: 'life' as const, chance: 0.3 }
  assert.equal(describeRule(eat), 'eat plants touching it (30% per touch)')
  assert.equal(describeRule({ ...eat, dir: 'south', neighbor: 'water', toNeighbor: 'plant', chance: 0.1 }), 'turn water to its south into plant (10% per touch)')
  assert.deepEqual(newRules([eat], [{ ...eat, chance: 0.5 }]), [], 'a chance tweak is not a new rule')
  assert.equal(newRules([], [eat]).length, 1)
  assert.deepEqual(adoptedWords(['kalu'], ['kalu', 'mito', 'zeze'], new Set(['mito'])), ['mito'])
})

test('demo minds eventually report new rules and adopted words in the feed', () => {
  const sim = createSim(3)
  let t = 0
  for (let k = 0; k < 600; k++) {
    frame(sim)
    think(sim, (t += 250), 1000)
  }
  const kinds = new Set(sim.colony.feed.events.map((e) => e.kind))
  assert.ok(kinds.has('rule'), 'no rule event')
  assert.ok(sim.colony.feed.events.filter((e) => e.kind === 'rule').every((e) => /changed its body's rules: now it will /.test(e.text)))
})

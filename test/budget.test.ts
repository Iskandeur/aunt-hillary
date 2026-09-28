// Paid minds must stay cheap: they take turns, a busy endpoint makes them wait quietly, and they
// sleep when nobody is watching.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DIVIDE_SIZE, activeMinds, createColony, heirOf, type Organism } from '../src/engine/organisms.ts'
import { MAX_CHANCE, MAX_GROW_CHANCE, validateRule } from '../src/engine/mind.ts'
import { FREE_GROWTH_SIZE, createSim, frame, think, THOUGHT_GAP_MS, type Sim } from '../src/engine/sim.ts'
import { LIFE, count } from '../src/engine/world.ts'

const REPLY = '{"thought":"hm","say":"lo","rules":[]}'
const tick = () => new Promise((r) => setImmediate(r))

function withFetch(handler: () => Response | Promise<Response>): { calls: () => number; restore: () => void } {
  const original = globalThis.fetch
  let n = 0
  globalThis.fetch = (async () => {
    n++
    return handler()
  }) as typeof fetch
  return { calls: () => n, restore: () => (globalThis.fetch = original) }
}

function llmSim(): Sim {
  const sim = createSim(3)
  for (let k = 0; k < 40; k++) frame(sim)
  assert.ok(activeMinds(sim.colony).length >= 3, 'expected several minds')
  sim.llm = { endpoint: 'https://x/v1/chat/completions', model: 'm', apiKey: 'k' }
  return sim
}

async function run(sim: Sim, ms: number, stepMs = 250): Promise<void> {
  for (let t = stepMs; t <= ms; t += stepMs) {
    think(sim, t)
    await tick()
  }
}

test('LLM minds take turns: one thought per gap, however many minds', async () => {
  const f = withFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: REPLY } }] })))
  try {
    const sim = llmSim()
    await run(sim, 60_000)
    const max = Math.floor(60_000 / THOUGHT_GAP_MS) + 1
    assert.ok(f.calls() <= max, `${f.calls()} calls in a minute, expected at most ${max}`)
    assert.ok(f.calls() >= max - 3, `minds should still think steadily, got ${f.calls()}`)
    assert.ok(sim.thoughts.length > 0)
  } finally {
    f.restore()
  }
})

test('never more than one LLM thought in flight', async () => {
  let pending = 0
  let peak = 0
  const f = withFetch(async () => {
    peak = Math.max(peak, ++pending)
    await new Promise((r) => setTimeout(r, 5))
    pending--
    return new Response(JSON.stringify({ choices: [{ message: { content: REPLY } }] }))
  })
  try {
    const sim = llmSim()
    for (let t = 250; t <= 20_000; t += 250) {
      think(sim, t, 5000, 0)
      await tick()
    }
    assert.equal(peak, 1)
  } finally {
    f.restore()
  }
})

test('a busy endpoint (429) makes minds wait quietly, without an error', async () => {
  const f = withFetch(() => new Response(JSON.stringify({ error: 'daily budget reached' }), { status: 429, headers: { 'Retry-After': '30' } }))
  try {
    const sim = llmSim()
    await run(sim, 29_000)
    assert.equal(f.calls(), 1, 'minds must not hammer a busy endpoint')
    assert.equal(sim.lastError, '')
    assert.match(sim.status, /daily budget reached/)
    await run(sim, 40_000)
    assert.ok(f.calls() >= 2, 'minds resume after Retry-After')
  } finally {
    f.restore()
  }
})

test('idle minds do not call the endpoint; physics goes on', async () => {
  const f = withFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: REPLY } }] })))
  try {
    const sim = llmSim()
    sim.idle = true
    await run(sim, 30_000)
    assert.equal(f.calls(), 0)
    assert.match(sim.status, /asleep/)
    sim.idle = false
    await run(sim, 5_000)
    assert.ok(f.calls() >= 1)
    assert.equal(sim.status, '')
  } finally {
    f.restore()
  }
})

test('growing into empty space is capped; eating is not', () => {
  const grow = validateRule({ dir: 'any', neighbor: 'empty', toNeighbor: 'life', chance: 0.5 })
  const eat = validateRule({ dir: 'any', neighbor: 'plant', toNeighbor: 'life', chance: 0.5 })
  assert.equal(typeof grow === 'object' && grow.chance, MAX_GROW_CHANCE)
  assert.equal(typeof eat === 'object' && eat.chance, MAX_CHANCE)
})

test('greedy bodies cannot fill the world: past FREE_GROWTH_SIZE only eating grows them', () => {
  const sim = createSim(3)
  const greedy = [
    { self: 'life', dir: 'any', neighbor: 'empty', toSelf: 'life', toNeighbor: 'life', chance: 0.05 },
    { self: 'life', dir: 'any', neighbor: 'sand', toSelf: 'life', toNeighbor: 'life', chance: 0.5 },
    { self: 'life', dir: 'any', neighbor: 'water', toSelf: 'life', toNeighbor: 'life', chance: 0.5 },
  ] as const
  for (let k = 0; k < 900; k++) {
    for (const o of sim.colony.orgs.values()) if (o.alive) o.rules = greedy.map((r) => ({ ...r }))
    frame(sim)
  }
  const life = count(sim.world, LIFE)
  const biggest = Math.max(...[...sim.colony.orgs.values()].filter((o) => o.alive).map((o) => o.size))
  assert.ok(biggest <= DIVIDE_SIZE + FREE_GROWTH_SIZE, `a body reached ${biggest} cells`)
  assert.ok(life < sim.world.cells.length / 3, `${life} life cells out of ${sim.world.cells.length}`)
})

test('a thought returning after a split or a merger reaches the heir', () => {
  const colony = createColony()
  const org = (id: number, extra: Partial<Organism>): Organism => {
    const base: Organism = {
      id, parent: null, gen: 0, born: 0, alive: true, fate: '', size: 30, cx: 0, cy: 0, rules: [], memory: [],
      thought: '', say: '', inbox: [], lexicon: [], hue: 0, nextThink: 0, thinking: false, whisper: '',
    }
    const o = { ...base, ...extra }
    colony.orgs.set(id, o)
    return o
  }
  const a = org(1, { alive: false, fate: 'divided' })
  org(2, { parent: 1, size: 40, alive: false, fate: 'merged into #4' })
  org(3, { parent: 1, size: 20 })
  const d = org(4, { size: 90 })
  const gone = org(5, { alive: false, fate: 'dissolved' })
  assert.equal(heirOf(colony, a), d, 'largest child first, followed through its merger')
  assert.equal(heirOf(colony, d), d)
  assert.equal(heirOf(colony, gone), null)
})

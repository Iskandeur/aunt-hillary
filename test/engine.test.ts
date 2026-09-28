import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RULES, EMPTY, LIFE, PLANT, SAND, WATER, applyRule, compile, count, createWorld, mulberry32, paint, step } from '../src/engine/world.ts'
import { DIVIDE_SIZE, MIN_SIZE, activeMinds, adjacency, createColony, divideOversized, lineage, updateOrganisms } from '../src/engine/organisms.ts'
import { INITIAL_VOCAB, applyReply, asciiView, conventions, demoMind, parseMindReply, validateRule } from '../src/engine/mind.ts'
import { createSim, frame, think } from '../src/engine/sim.ts'

const world = (w = 16, h = 16, seed = 1) => createWorld(w, h, mulberry32(seed))

test('sand falls and conserves mass', () => {
  const wd = world()
  wd.cells[2 * 16 + 5] = SAND
  for (let k = 0; k < 40; k++) step(wd, DEFAULT_RULES.map(compile))
  assert.equal(count(wd, SAND), 1)
  assert.equal(wd.cells[15 * 16 + 5] === SAND || wd.cells.slice(15 * 16).includes(SAND), true)
})

test('a rule fires only on a matching pair, and a swap carries ownership', () => {
  const wd = world()
  const i = 5 * 16 + 5
  wd.cells[i] = LIFE
  wd.owner[i] = 9
  const fall = compile({ self: 'life', dir: 'down', neighbor: 'empty', toSelf: 'empty', toNeighbor: 'life', chance: 1 })
  assert.equal(applyRule(wd, i, compile({ ...DEFAULT_RULES[0] })), false)
  assert.equal(applyRule(wd, i, fall), true)
  assert.equal(wd.cells[i], EMPTY)
  assert.equal(wd.owner[i + 16], 9)
  assert.equal(wd.owner[i], -1)
})

test('eating a plant makes a life cell owned by the eater', () => {
  const wd = world()
  const i = 5 * 16 + 5
  wd.cells[i] = LIFE
  wd.owner[i] = 3
  wd.cells[i + 1] = PLANT
  const eat = compile({ self: 'life', dir: 'right', neighbor: 'plant', toSelf: 'life', toNeighbor: 'life', chance: 1 })
  assert.equal(applyRule(wd, i, eat), true)
  assert.equal(wd.owner[i + 1], 3)
})

test('a big enough region awakes as one organism; a small one does not', () => {
  const wd = world(32, 32)
  paint(wd, 8, 8, 3, LIFE) // 29 cells
  paint(wd, 24, 24, 1, LIFE) // 5 cells
  const col = createColony()
  updateOrganisms(wd, col)
  const alive = [...col.orgs.values()].filter((o) => o.alive)
  assert.equal(alive.length, 1)
  assert.ok(alive[0].size >= MIN_SIZE)
  assert.equal(wd.owner[24 * 32 + 24], -1)
})

test('fusion: two organisms whose bodies join become one, memory is merged', () => {
  const wd = world(32, 32)
  paint(wd, 8, 8, 3, LIFE)
  paint(wd, 20, 8, 3, LIFE)
  const col = createColony()
  updateOrganisms(wd, col)
  assert.equal(activeMinds(col).length, 2)
  const [a, b] = activeMinds(col)
  b.memory.push('secret of b')
  for (let x = 8; x <= 20; x++) wd.cells[8 * 32 + x] = LIFE // a bridge
  updateOrganisms(wd, col)
  const alive = activeMinds(col)
  assert.equal(alive.length, 1)
  const survivor = alive[0]
  assert.ok([a.id, b.id].includes(survivor.id))
  const absorbed = survivor.id === a.id ? b : a
  assert.match(absorbed.fate, /merged/)
  if (absorbed === b) assert.ok(survivor.memory.some((m) => m.includes('secret of b')))
})

test('division: an oversized body is cut, two children inherit memory and rules', () => {
  const wd = world(40, 40)
  for (let y = 10; y < 20; y++) for (let x = 5; x < 25; x++) wd.cells[y * 40 + x] = LIFE // 200 cells
  const col = createColony()
  updateOrganisms(wd, col)
  const [parent] = activeMinds(col)
  assert.ok(parent.size > DIVIDE_SIZE)
  parent.memory.push('ancestral idea')
  parent.rules = [{ self: 'life', dir: 'any', neighbor: 'plant', toSelf: 'life', toNeighbor: 'life', chance: 0.2 }]
  assert.deepEqual(divideOversized(wd, col), [parent.id])
  updateOrganisms(wd, col)
  assert.equal(parent.alive, false)
  assert.equal(parent.fate, 'divided')
  const kids = activeMinds(col)
  assert.equal(kids.length, 2)
  for (const k of kids) {
    assert.equal(k.parent, parent.id)
    assert.equal(k.gen, 1)
    assert.ok(k.memory.includes('ancestral idea'))
    assert.equal(k.rules.length, 1)
    assert.deepEqual(lineage(col, k.id), [k.id, parent.id])
  }
})

test('the graph is born of space: only touching bodies are linked', () => {
  const wd = world(48, 16)
  paint(wd, 5, 8, 3, LIFE)
  paint(wd, 13, 8, 3, LIFE) // one empty column between the two bodies
  paint(wd, 40, 8, 3, LIFE)
  const col = createColony()
  updateOrganisms(wd, col)
  const edges = adjacency(wd, col)
  assert.equal(edges.length, 1)
})

test('ASCII view marks own body and others differently', () => {
  const wd = world(32, 32)
  paint(wd, 8, 8, 3, LIFE)
  paint(wd, 16, 8, 3, LIFE)
  const col = createColony()
  updateOrganisms(wd, col)
  const [a] = activeMinds(col)
  const v = asciiView(wd, a, 8)
  assert.ok(v.includes('o'))
  assert.ok(v.includes('x'))
  assert.equal(v.split('\n').length, 17)
})

test('parseMindReply extracts fenced JSON and bounds everything', () => {
  const text = 'Sure!\n```json\n{"thought":"I hunger","say":"zuka food","remember":"zuka = food","rules":[' +
    '{"self":"wall","dir":"any","neighbor":"plant","toSelf":"life","toNeighbor":"life","chance":0.9},' +
    '{"dir":"sideways","neighbor":"plant","toNeighbor":"life"},' +
    '{"dir":"up","neighbor":"empty","toNeighbor":"wall"},' +
    '{"dir":"up","neighbor":"empty","toNeighbor":"life"},{"dir":"up","neighbor":"empty","toNeighbor":"life"},' +
    '{"dir":"up","neighbor":"empty","toNeighbor":"life"},{"dir":"up","neighbor":"empty","toNeighbor":"life"}]}\n```'
  const { reply, errors } = parseMindReply(text)
  assert.ok(reply)
  assert.equal(reply.rules.length, 4)
  assert.equal(reply.rules[0].self, 'life') // a mind can only rewrite its own body
  assert.equal(reply.rules[0].chance, 0.5)
  assert.equal(errors.length, 2) // bad dir, wall is not a body element
})

test('parseMindReply rejects non-JSON', () => {
  assert.equal(parseMindReply('I think therefore I am').reply, null)
  assert.equal(parseMindReply('{not json}').reply, null)
  assert.equal(typeof validateRule(null), 'string')
})

test('conventions count only what two minds share and nobody gave them', () => {
  const col = createColony()
  const wd = world(48, 16)
  paint(wd, 5, 8, 3, LIFE)
  paint(wd, 20, 8, 3, LIFE)
  paint(wd, 40, 8, 3, LIFE)
  updateOrganisms(wd, col)
  const [a, b, c] = activeMinds(col)
  const eat = { self: 'life' as const, dir: 'up' as const, neighbor: 'plant' as const, toSelf: 'life' as const, toNeighbor: 'life' as const, chance: 0.2 }
  applyReply(a, { thought: '', say: 'zuka food', remember: '', rules: [eat] })
  applyReply(b, { thought: '', say: 'zuka water', remember: '', rules: [eat] })
  applyReply(c, { thought: '', say: 'mira', remember: '', rules: [] })
  assert.ok(INITIAL_VOCAB.has('water'))
  const conv = conventions(col.orgs.values(), DEFAULT_RULES)
  assert.deepEqual(conv.words.map((w) => w.word), ['zuka'])
  assert.equal(conv.rules.length, 1)
  assert.equal(conv.total, 2)
})

test('demo minds invent words, and neighbours adopt them by contact', () => {
  const sim = createSim(3)
  for (let k = 0; k < 20; k++) frame(sim)
  const minds = activeMinds(sim.colony)
  assert.ok(minds.length >= 3, `expected organisms, got ${minds.length}`)
  let t = 0
  for (let k = 0; k < 400; k++) {
    frame(sim)
    think(sim, (t += 250), 1000)
  }
  const all = [...sim.colony.orgs.values()]
  assert.ok(all.some((o) => o.thought.length > 0))
  assert.ok(all.some((o) => o.memory.some((m) => m.startsWith('word "'))))
  assert.ok(all.every((o) => o.rules.every((r) => r.self === 'life' && r.chance <= 0.5)))
  assert.ok(all.every((o) => !o.say.includes('undefined')), 'a demo mind spoke a word it never coined')
})

test('llmMind posts an OpenAI-compatible request and parses the reply', async () => {
  const seen: { url?: string; body?: any; auth?: string } = {}
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.url = url
    seen.body = JSON.parse(String(init.body))
    seen.auth = (init.headers as Record<string, string>).Authorization
    const content = '{"thought":"hm","say":"lo","rules":[{"dir":"up","neighbor":"empty","toNeighbor":"life","chance":2}]}'
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
  }) as typeof fetch
  try {
    const { llmMind } = await import('../src/engine/mind.ts')
    const { reply } = await llmMind({ endpoint: 'https://x/v1/chat/completions', model: 'm', apiKey: 'k' }, [{ role: 'user', content: 'hi' }])
    assert.equal(seen.url, 'https://x/v1/chat/completions')
    assert.equal(seen.body.model, 'm')
    assert.equal(seen.auth, 'Bearer k')
    assert.equal(reply?.rules[0].chance, 0.5)
  } finally {
    globalThis.fetch = original
  }
})

test('demoMind never emits an invalid rule', () => {
  const sim = createSim(5)
  for (let k = 0; k < 20; k++) frame(sim)
  for (const o of activeMinds(sim.colony)) {
    const r = demoMind(sim.world, o, mulberry32(1))
    for (const rule of r.rules) assert.equal(typeof validateRule(rule), 'object')
  }
  assert.ok(count(sim.world, WATER) > 0)
})

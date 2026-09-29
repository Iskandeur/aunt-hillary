// What makes a body someone: energy at stake, an inherited nature, a story, a say in fusion.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY, LIFE, PLANT, WATER, applyRule, compile, count, createWorld, moveBody, mulberry32, paint } from '../src/engine/world.ts'
import { DIVIDE_SIZE, GROW_COST, PLANT_ENERGY, TRAITS, activeMinds, createColony, divideOversized, metabolize, mutate, updateOrganisms } from '../src/engine/organisms.ts'
import { SYSTEM_PROMPT, buildMessages, demoMind, isInvented, parseMindReply } from '../src/engine/mind.ts'
import { createSim, frame, giveEnergy, think } from '../src/engine/sim.ts'

const body = (w = 32, h = 32) => {
  const wd = createWorld(w, h, mulberry32(4))
  paint(wd, 8, 8, 3, LIFE)
  const col = createColony()
  updateOrganisms(wd, col)
  return { wd, col, o: activeMinds(col)[0] }
}

test('a body without food starves: it loses cells, then dies', () => {
  const { wd, col, o } = body()
  o.energy = 0
  for (let k = 0; k < 40 && o.alive; k++) {
    metabolize(wd, col)
    updateOrganisms(wd, col)
  }
  assert.equal(o.alive, false)
  assert.equal(o.fate, 'starved')
  assert.ok(o.diary.some((d) => d.includes('starving')))
  assert.ok(count(wd, PLANT) > 0, 'dead cells feed the living')
})

test('eating pays and growing costs: a body with no energy cannot grow', () => {
  const { wd, col, o } = body()
  const ledger = {
    can: (id: number, grew: number) => col.orgs.get(id)!.energy >= grew * GROW_COST,
    book: (id: number, e: { ate: number; grew: number }) => (col.orgs.get(id)!.energy += e.ate * PLANT_ENERGY - e.grew * GROW_COST),
  }
  const i = 8 * 32 + 11 // east edge of the body
  wd.cells[i + 1] = PLANT
  o.energy = 0
  assert.equal(applyRule(wd, i, compile({ self: 'life', dir: 'east', neighbor: 'plant', toSelf: 'life', toNeighbor: 'life', chance: 1 }), ledger), false)
  assert.equal(applyRule(wd, i, compile({ self: 'life', dir: 'east', neighbor: 'plant', toSelf: 'life', toNeighbor: 'ground', chance: 1 }), ledger), true)
  assert.equal(o.energy, PLANT_ENERGY)
})

test('a body walks: same size, it moves, and cannot cross water', () => {
  const { wd, o } = body()
  const before = o.cx
  const r = moveBody(wd, o.id, 'east', 20)
  assert.equal(r.moved, 20)
  let n = 0, sx = 0
  for (let i = 0; i < wd.owner.length; i++) if (wd.owner[i] === o.id) n++, (sx += i % 32)
  assert.equal(n, o.size)
  assert.ok(sx / n > before)
  for (let y = 0; y < 32; y++) wd.cells[y * 32 + 20] = WATER
  moveBody(wd, o.id, 'east', 200)
  for (let y = 0; y < 32; y++) assert.equal(wd.cells[y * 32 + 20], WATER)
})

test('fusion needs consent: a refusing body stays itself', () => {
  const wd = createWorld(32, 32, mulberry32(2))
  paint(wd, 8, 8, 3, LIFE)
  paint(wd, 18, 8, 3, LIFE)
  const col = createColony()
  updateOrganisms(wd, col)
  const [a, b] = activeMinds(col)
  a.fusion = 'accept'
  b.fusion = 'refuse'
  for (let x = 8; x <= 18; x++) (wd.cells[8 * 32 + x] = LIFE), (wd.owner[8 * 32 + x] = x < 13 ? Math.min(a.id, b.id) : Math.max(a.id, b.id))
  updateOrganisms(wd, col)
  assert.equal(activeMinds(col).length, 2)
  assert.ok(col.feed.events.some((e) => e.kind === 'refused'))
  b.fusion = 'accept'
  updateOrganisms(wd, col)
  assert.equal(activeMinds(col).length, 1)
})

test('children inherit nature (with a small mutation), story and self-portrait', () => {
  const wd = createWorld(40, 40, mulberry32(5))
  for (let y = 10; y < 20; y++) for (let x = 5; x < 25; x++) wd.cells[y * 40 + x] = LIFE
  const col = createColony()
  updateOrganisms(wd, col)
  const [p] = activeMinds(col)
  assert.ok(p.size > DIVIDE_SIZE)
  p.self = 'I am the first grazer.'
  p.energy = 100
  divideOversized(wd, col)
  updateOrganisms(wd, col)
  const kids = activeMinds(col)
  assert.equal(kids.length, 2)
  for (const k of kids) {
    assert.equal(k.self, 'I am the first grazer.')
    assert.ok(k.diary.some((d) => d.includes(`#${p.id} split`)))
    for (const t of TRAITS) assert.ok(Math.abs(k.temperament[t] - p.temperament[t]) <= 0.151)
  }
  assert.ok(Math.abs(kids[0].energy + kids[1].energy - 100) < 1e-9)
  const m = mutate(p.temperament, mulberry32(1), 0)
  assert.deepEqual(m, p.temperament)
})

test('energy is given only to a body nearby, never more than half', () => {
  const sim = createSim(3)
  for (let k = 0; k < 20; k++) frame(sim)
  const [a, b] = activeMinds(sim.colony).map((o) => o.id)
  sim.edges = [[a, b]]
  const A = sim.colony.orgs.get(a)!, B = sim.colony.orgs.get(b)!
  A.energy = 40
  const before = B.energy
  assert.equal(giveEnergy(sim, A, b, 1000), 20)
  assert.equal(B.energy, before + 20)
  const far = [...sim.colony.orgs.values()].find((o) => o.alive && o !== A && !sim.edges.some(([x, y]) => (x === a && y === o.id) || (y === a && x === o.id)))
  if (far) assert.equal(giveEnergy(sim, A, far.id, 5), 0)
})

test('the prompt describes the physics without prescribing a strategy', () => {
  assert.doesNotMatch(SYSTEM_PROMPT, /to grow, eat|you should|your goal/i)
  assert.match(SYSTEM_PROMPT, /seen from above/)
  assert.doesNotMatch(SYSTEM_PROMPT, /gravity|\bfall|\bbelow\b|\bdown\b/)
  const { wd, o } = body()
  const user = buildMessages(wd, o, [])[1].content
  assert.match(user, /Your nature \(inherited, not chosen\)/)
  assert.match(user, /What has happened to you/)
  assert.match(user, /Energy \d+/)
})

test('replies carry self, move, fusion and gifts, all bounded', () => {
  const { reply } = parseMindReply(JSON.stringify({
    thought: 't', say: '', self: 'I am ' + 'very '.repeat(40), move: 'up', fusion: 'refuse', give: { to: '#7', amount: 12 }, rules: [],
  }))
  assert.ok(reply)
  assert.ok(reply.self!.split(' ').length <= 26)
  assert.equal(reply.move, 'north')
  assert.equal(reply.fusion, 'refuse')
  assert.deepEqual(reply.give, { to: 7, amount: 12 })
  assert.equal(parseMindReply('{"move":"sideways"}').reply!.move, null)
})

test('only invented words count as language', () => {
  for (const w of ['south', 'moving', 'share', 'plants', 'eating', 'hungry']) assert.equal(isInvented(w), false, w)
  for (const w of ['zuka', 'tosenlu', 'kamiri']) assert.equal(isInvented(w), true, w)
})

test('isInvented: everyday English with its endings is never an invention (garden season 3: "abundant")', () => {
  const real = ['abundant', 'abundance', 'abundantly', 'glimmer', 'glimmering', 'thrive', 'thrives', 'thrived', 'thriving',
    'flickers', 'sunniest', 'happily', 'hopping', 'stopped', 'carries', 'carried', 'nourishing', 'bountiful', 'endless', 'kinship', 'wander', 'wanderers', 'lush', 'lushness']
  for (const w of real) assert.equal(isInvented(w), false, w)
  const made = ['zorbu', 'glimmak', 'thrivu', 'kelumi', 'vashti', 'nuzo', 'plorbing', 'zukas']
  for (const w of made) assert.equal(isInvented(w), true, w)
})

test('demo minds differ by nature, and the world does not freeze', () => {
  const sim = createSim(7)
  let t = 0
  const alive: number[] = []
  for (let k = 1; k <= 2400; k++) {
    frame(sim)
    think(sim, (t += 143), 5000)
    if (k % 400 === 0) alive.push([...sim.colony.orgs.values()].filter((o) => o.alive).length)
  }
  const all = [...sim.colony.orgs.values()]
  assert.ok(all.length > 15, `only ${all.length} bodies ever lived`)
  assert.ok(alive.every((n) => n > 0), `extinction: ${alive}`)
  assert.ok(new Set(all.map((o) => o.fate)).size >= 3, 'bodies divide, merge and die')
  assert.ok(all.some((o) => o.self.startsWith('I am')))
  const greedy = { ...all[0], temperament: { curiosity: 0, greed: 1, sociability: 0, caution: 1 }, heading: null, hungry: true }
  const shy = { ...all[0], temperament: { curiosity: 1, greed: 0, sociability: 1, caution: 0 }, heading: null, hungry: false }
  const g = demoMind(sim.world, greedy, mulberry32(1)), s = demoMind(sim.world, shy, mulberry32(1))
  assert.equal(g.fusion, 'refuse')
  assert.equal(s.fusion, 'accept')
  assert.notEqual(g.thought + g.self, s.thought + s.self)
  assert.equal(EMPTY, 0)
})

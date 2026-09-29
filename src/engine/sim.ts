// The loop that binds the two time scales: physics every frame, identities every few frames,
// and each active mind thinking every THINK_MS (default ~5 s), asynchronously, between frames.

import { GROW_COST, MAX_MINDS, MOVE_COST, PLANT_ENERGY, activeMinds, adjacency, createColony, divideOversized, heirOf, metabolize, neighborsOf, note, updateOrganisms, type Colony, type Organism } from './organisms.ts'
import { applyReply, buildMessages, demoMind, isInvented, llmMind, words, type LlmConfig, type MindReply } from './mind.ts'
import { adoptedWords, gaveText, newRules, pushFeed, ruleText, selfText, settleBirths, wordText } from './feed.ts'
import { DEFAULT_RAIN, DEFAULT_RULES, EMPTY, GRASS, LIFE, PLANT, WALL, WATER, compile, createWorld, moveBody, mulberry32, paint, step, type CRule, type Ledger, type Rule, type World } from './world.ts'

export const THINK_MS = 5000
export const IDENTITY_EVERY = 10
/** LLM minds take turns: one thought in flight at a time, at most one new thought per THOUGHT_GAP_MS.
 *  Eight minds on a 5 s cadence would be ~96 paid calls a minute; this caps it near 20. */
export const THOUGHT_GAP_MS = 3000
/** How long a mind's thought stays in its bubble on the canvas. */
export const BUBBLE_MS = 6000

export interface Sim {
  world: World
  colony: Colony
  rules: Rule[]
  compiled: CRule[]
  edges: Array<[number, number]>
  llm: LlmConfig | null
  lastError: string
  thoughts: Array<{ id: number; tick: number; text: string; self: string }>
  /** LLM thoughts currently awaiting an answer. */
  inFlight: number
  /** Clock time before which no new LLM thought starts (turn-taking). */
  nextThoughtAt: number
  /** Clock time until which the endpoint asked us to wait. */
  busyUntil: number
  /** Set by the UI when nobody has touched the page for a while: LLM minds sleep, physics goes on. */
  idle: boolean
  /** One short line on why minds are quiet, or '' when they think normally. */
  status: string
  /** Last clock value seen by think(): replies that land between frames are stamped with it. */
  clock: number
  /** Demo thoughts waiting out their pretend latency. */
  pending: Array<{ org: Organism; reply: MindReply; at: number }>
  /** Pairs of bodies that have already met (for their diaries). */
  met: Set<string>
  /** Tick of the last spontaneous birth. */
  lastSpawn: number
}

/** A meadow seen from above: grass everywhere, patches of bare ground, three lakes ringed with
 *  plants, rock ridges, and five small bodies scattered between them. */
export function seedWorld(world: World): void {
  const { w, h, rng } = world
  world.cells.fill(GRASS)
  world.owner.fill(-1)
  const blob = (cx: number, cy: number, rx: number, ry: number, el: number) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        if (d <= 1 + (rng() - 0.5) * 0.35) world.cells[y * w + x] = el
      }
  }
  const sx = w / 64, sy = h / 64
  for (const [cx, cy, r] of [[48, 10, 6], [12, 50, 7], [40, 44, 5]]) blob(cx * sx, cy * sy, (r + 3) * sx, (r + 3) * sy, EMPTY)
  for (const [cx, cy, rx, ry] of [[14, 14, 6, 4], [50, 30, 5, 7], [28, 52, 7, 4]]) {
    blob(cx * sx, cy * sy, (rx + 3) * sx, (ry + 3) * sy, PLANT)
    blob(cx * sx, cy * sy, rx * sx, ry * sy, WATER)
  }
  // Rock ridges: obstacles that split the meadow into regions.
  for (let x = Math.round(24 * sx); x < Math.round(40 * sx); x++) world.cells[Math.round(30 * sy) * w + x] = WALL
  for (let y = Math.round(4 * sy); y < Math.round(20 * sy); y++) world.cells[y * w + Math.round(32 * sx)] = WALL
  for (let y = Math.round(38 * sy); y < Math.round(48 * sy); y++) world.cells[y * w + Math.round(56 * sx)] = WALL
  for (const [cx, cy] of [[26, 16], [8, 32], [40, 24], [20, 40], [52, 50]]) paint(world, Math.round(cx * sx), Math.round(cy * sy), 3, LIFE)
  world.rain = DEFAULT_RAIN
}

export function createSim(seed = 7, w = 64, h = 64): Sim {
  const world = createWorld(w, h, mulberry32(seed))
  seedWorld(world)
  const rules = DEFAULT_RULES.map((r) => ({ ...r }))
  return {
    world, colony: createColony(), rules, compiled: rules.map(compile), edges: [], llm: null, lastError: '', thoughts: [],
    inFlight: 0, nextThoughtAt: 0, busyUntil: 0, idle: false, status: '', clock: 0, pending: [], met: new Set(), lastSpawn: 0,
  }
}

export function setRules(sim: Sim, rules: Rule[]): void {
  sim.rules = rules
  sim.compiled = rules.map(compile)
}

/** Above this size a body grows only by eating plants: its rules that turn anything else into life
 *  are set aside. LLM minds that grew freely filled the world with two giant bodies. */
export const FREE_GROWTH_SIZE = 80
const makesLifeFromNonFood = (r: Rule) => r.toNeighbor === 'life' && r.neighbor !== 'plant' && r.neighbor !== 'life'
/** Bodies walk every MOVE_EVERY frames, a few cells at a time. */
export const MOVE_EVERY = 2
/** When fewer bodies than this are alive, new life stirs by a lake now and then. */
export const MIN_BODIES = 3
export const SPAWN_EVERY = 200

/** The ledger that makes rules pay: growth needs energy, eating earns it. */
function ledgerOf(colony: Colony): Ledger {
  return {
    can: (id, grew) => (colony.orgs.get(id)?.energy ?? 0) >= grew * GROW_COST,
    book: (id, e) => {
      const o = colony.orgs.get(id)
      if (o) o.energy += e.ate * PLANT_ENERGY - e.grew * GROW_COST
    },
  }
}

/** Abiogenesis: a small clump of life appears on open ground next to water. */
export function spawnLife(world: World): boolean {
  const { w, h, cells, rng } = world
  for (let k = 0; k < 200; k++) {
    const x = 4 + Math.floor(rng() * (w - 8)), y = 4 + Math.floor(rng() * (h - 8))
    let water = false, clear = true
    for (let dy = -4; dy <= 4 && clear; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const c = cells[(y + dy) * w + x + dx]
        if (c === WATER) water = true
        if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3 && (c === WATER || c === WALL || c === LIFE)) (clear = false)
      }
    if (water && clear) {
      paint(world, x, y, 3, LIFE)
      return true
    }
  }
  return false
}

/** One physics frame; every IDENTITY_EVERY frames, re-read who is who and run the metabolism. */
export function frame(sim: Sim): void {
  const orgRules = new Map<number, CRule[]>()
  for (const o of sim.colony.orgs.values()) {
    if (!o.alive || !o.rules.length) continue
    const rules = o.size >= FREE_GROWTH_SIZE ? o.rules.filter((r) => !makesLifeFromNonFood(r)) : o.rules
    if (rules.length) orgRules.set(o.id, rules.map(compile))
  }
  step(sim.world, sim.compiled, orgRules, ledgerOf(sim.colony))
  if (sim.world.tick % MOVE_EVERY === 0)
    for (const o of sim.colony.orgs.values()) {
      if (!o.alive || !o.heading) continue
      const { moved, ate } = moveBody(sim.world, o.id, o.heading, Math.max(1, Math.round(o.size / 12)))
      o.energy += ate * PLANT_ENERGY - moved * MOVE_COST
      if (!moved) {
        if (!o.diary[o.diary.length - 1]?.includes('blocked walking')) note(o, sim.world.tick, `blocked walking ${o.heading}`)
        o.heading = null
      }
    }
  if (sim.world.tick % IDENTITY_EVERY === 0) {
    divideOversized(sim.world, sim.colony)
    metabolize(sim.world, sim.colony)
    updateOrganisms(sim.world, sim.colony)
    sim.edges = adjacency(sim.world, sim.colony)
    for (const [a, b] of sim.edges) {
      if (sim.met.has(a + "," + b)) continue
      sim.met.add(a + "," + b)
      note(sim.colony.orgs.get(a)!, sim.world.tick, `met #${b}`)
      note(sim.colony.orgs.get(b)!, sim.world.tick, `met #${a}`)
    }
    const minds = new Set(activeMinds(sim.colony).map((o) => o.id))
    settleBirths(sim.colony.feed, (id) => minds.has(id), MAX_MINDS)
    const alive = [...sim.colony.orgs.values()].filter((o) => o.alive).length
    if (alive < MIN_BODIES && sim.world.tick - sim.lastSpawn >= SPAWN_EVERY && spawnLife(sim.world)) sim.lastSpawn = sim.world.tick
  }
}

/** Energy moves only between bodies near each other, and never more than half of what the giver has. */
export function giveEnergy(sim: Sim, from: Organism, to: number, amount: number): number {
  const other = sim.colony.orgs.get(to)
  if (!other?.alive || other === from || !neighborsOf(from.id, sim.edges).includes(to)) return 0
  const a = Math.min(amount, from.energy / 2)
  if (a < 1) return 0
  from.energy -= a
  other.energy += a
  const tick = sim.world.tick
  note(from, tick, `gave ${Math.round(a)} energy to #${to}`)
  note(other, tick, `received ${Math.round(a)} energy from #${from.id}`)
  pushFeed(sim.colony.feed, tick, 'gave', from.id, gaveText(from.id, to, a))
  return a
}

function deliver(sim: Sim, org: Organism, reply: MindReply): void {
  const rulesBefore = org.rules
  const saidBefore = org.lexicon
  const selfBefore = org.self
  applyReply(org, reply)
  const tick = sim.world.tick
  if (reply.rules.length) for (const r of newRules(rulesBefore, org.rules).slice(0, 2)) pushFeed(sim.colony.feed, tick, 'rule', org.id, ruleText(org.id, r))
  if (org.self && org.self !== selfBefore && sim.llm) pushFeed(sim.colony.feed, tick, 'self', org.id, selfText(org.id, org.self))
  if (reply.give) giveEnergy(sim, org, reply.give.to, reply.give.amount)
  const others = new Set<string>()
  for (const o of sim.colony.orgs.values()) if (o.alive && o !== org) for (const w of o.lexicon) others.add(w)
  const fresh = words(reply.say).filter((w) => isInvented(w))
  for (const w of adoptedWords(saidBefore, fresh, others)) pushFeed(sim.colony.feed, tick, 'word', org.id, wordText(org.id, w))
  if (reply.thought) {
    org.bubble = reply.thought
    org.bubbleUntil = sim.clock + BUBBLE_MS
  }
  org.whisper = ''
  if (reply.thought) sim.thoughts = [...sim.thoughts, { id: org.id, tick: sim.world.tick, text: reply.thought, self: org.self }].slice(-80)
  if (!reply.say) return
  // Speech only reaches minds whose bodies are near this one.
  for (const n of neighborsOf(org.id, sim.edges)) {
    const other = sim.colony.orgs.get(n)
    if (other?.alive) other.inbox = [...other.inbox, { from: org.id, text: reply.say, tick: sim.world.tick }].slice(-6)
  }
}

export interface ThinkOptions {
  /** Demo minds take turns too: at most one new demo thought per demoGapMs (0 = each on its own cadence). */
  demoGapMs?: number
  /** A demo thought lands this long after it starts, so the page can show who is thinking. */
  demoLatencyMs?: number
}

/** Wake the minds whose turn has come. Demo minds answer locally, each on its own cadence unless
 *  told to take turns; LLM minds take turns (one in flight, one start per gapMs) because every
 *  thought is paid. The UI slows gapMs down with the speed control. */
export function think(sim: Sim, now: number, thinkMs = THINK_MS, gapMs = THOUGHT_GAP_MS, opts: ThinkOptions = {}): void {
  sim.clock = now
  const minds = activeMinds(sim.colony)
  // Stagger first thoughts so eight minds do not all speak on the same frame.
  minds.forEach((org, k) => {
    if (org.nextThink === 0) org.nextThink = now + (k * thinkMs) / minds.length
  })
  if (!sim.llm) {
    sim.status = ''
    const { demoGapMs = 0, demoLatencyMs = 0 } = opts
    for (const p of sim.pending.filter((p) => now >= p.at)) {
      p.org.thinking = false
      const heir = heirOf(sim.colony, p.org)
      if (heir) deliver(sim, heir, p.reply)
    }
    sim.pending = sim.pending.filter((p) => now < p.at)
    const ready = minds.filter((o) => !o.thinking && now >= o.nextThink).sort((a, b) => a.nextThink - b.nextThink)
    for (const org of ready) {
      if (demoGapMs > 0 && (now < sim.nextThoughtAt || sim.pending.length)) break
      org.nextThink = now + thinkMs
      sim.nextThoughtAt = now + demoGapMs
      const near = neighborsOf(org.id, sim.edges).map((id) => sim.colony.orgs.get(id)!).filter(Boolean)
      const reply = demoMind(sim.world, org, sim.world.rng, sim.colony, near)
      if (demoLatencyMs > 0) {
        org.thinking = true
        sim.pending.push({ org, reply, at: now + demoLatencyMs })
      } else deliver(sim, org, reply)
    }
    return
  }
  // Switched from demo to LLM minds mid-thought: drop the pretend thoughts.
  for (const p of sim.pending) p.org.thinking = false
  sim.pending = []
  // A busy answer arrives on the network's clock; convert it to ours on the next frame.
  if (sim.busyUntil < 0) sim.busyUntil = now - sim.busyUntil
  if (sim.idle) {
    sim.status = 'Minds asleep: nobody has touched the page for a while. Move the mouse or tap to wake them.'
    return
  }
  if (now < sim.busyUntil) return
  sim.status = ''
  if (sim.inFlight > 0 || now < sim.nextThoughtAt) return
  // The mind that has waited longest goes next.
  const org = minds.filter((o) => !o.thinking && now >= o.nextThink).sort((a, b) => a.nextThink - b.nextThink)[0]
  if (!org) return
  org.nextThink = now + thinkMs
  sim.nextThoughtAt = now + gapMs
  const neighbors = neighborsOf(org.id, sim.edges).map((id) => sim.colony.orgs.get(id)!).filter(Boolean)
  org.thinking = true
  sim.inFlight++
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 30000)
  llmMind(sim.llm, buildMessages(sim.world, org, neighbors, sim.colony), ctl.signal)
    .then(({ reply, errors, busy }) => {
      if (busy) {
        // Not an error: the endpoint asked us to slow down. Minds wait quietly, nothing is lost.
        sim.busyUntil = -busy.ms
        sim.status = `Minds waiting: ${busy.reason}`
        return
      }
      if (errors.length) sim.lastError = `#${org.id}: ${errors[0]}`
      else sim.lastError = ''
      // Bodies split and merge while a thought is on the wire: a paid thought goes to the heir.
      const heir = heirOf(sim.colony, org)
      if (reply && heir) deliver(sim, heir, reply)
    })
    .catch((e) => {
      const msg = (e as Error).message
      // A network-level TypeError from fetch is almost always CORS: the endpoint refuses browsers.
      sim.lastError = e instanceof TypeError
        ? `#${org.id}: ${msg}. The endpoint probably refuses browser (CORS) calls; OpenRouter accepts them.`
        : `#${org.id}: ${msg}`
    })
    .finally(() => {
      clearTimeout(timer)
      org.thinking = false
      sim.inFlight--
    })
}

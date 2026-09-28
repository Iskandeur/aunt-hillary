// The loop that binds the two time scales: physics every frame, identities every few frames,
// and each active mind thinking every THINK_MS (default ~5 s), asynchronously, between frames.

import { MAX_MINDS, activeMinds, adjacency, createColony, divideOversized, heirOf, neighborsOf, updateOrganisms, type Colony, type Organism } from './organisms.ts'
import { INITIAL_VOCAB, applyReply, buildMessages, demoMind, llmMind, words, type LlmConfig, type MindReply } from './mind.ts'
import { adoptedWords, newRules, pushFeed, ruleText, settleBirths, wordText } from './feed.ts'
import { DEFAULT_RULES, LIFE, PLANT, SAND, WALL, WATER, compile, createWorld, mulberry32, paint, step, type CRule, type Rule, type World } from './world.ts'

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
  thoughts: Array<{ id: number; tick: number; text: string }>
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
}

export function seedWorld(world: World): void {
  const { w, h } = world
  paint(world, 0, 0, 0, 0)
  for (let x = 0; x < w; x++) for (let y = h - 6; y < h; y++) world.cells[y * w + x] = SAND
  for (let x = 20; x < 44; x++) world.cells[(h - 7) * w + x] = WALL
  for (let x = 22; x < 42; x++) for (let y = h - 12; y < h - 7; y++) world.cells[y * w + x] = WATER
  for (const px of [6, 12, 50, 57]) for (let y = h - 14; y < h - 6; y++) world.cells[y * w + px] = PLANT
  for (const [cx, cy] of [[10, 44], [54, 44], [32, 22], [24, 36], [42, 36]]) paint(world, cx, cy, 3, LIFE)
  for (let x = 0; x < w; x++) world.cells[x + 18 * w] = x % 16 < 5 ? WALL : world.cells[x + 18 * w]
  world.rain = 0.004
}

export function createSim(seed = 7, w = 64, h = 64): Sim {
  const world = createWorld(w, h, mulberry32(seed))
  seedWorld(world)
  const rules = DEFAULT_RULES.map((r) => ({ ...r }))
  return {
    world, colony: createColony(), rules, compiled: rules.map(compile), edges: [], llm: null, lastError: '', thoughts: [],
    inFlight: 0, nextThoughtAt: 0, busyUntil: 0, idle: false, status: '', clock: 0, pending: [],
  }
}

export function setRules(sim: Sim, rules: Rule[]): void {
  sim.rules = rules
  sim.compiled = rules.map(compile)
}

/** Above this size a body grows only by eating plants: its rules that turn anything else into life
 *  are set aside. The demo minds always kept to this; LLM minds did not, and filled the world with
 *  two giant bodies that split and re-merged every few frames. */
export const FREE_GROWTH_SIZE = 80
const makesLifeFromNonFood = (r: Rule) => r.toNeighbor === 'life' && r.neighbor !== 'plant' && r.neighbor !== 'life'

/** One physics frame; every IDENTITY_EVERY frames, re-read who is who. */
export function frame(sim: Sim): void {
  const orgRules = new Map<number, CRule[]>()
  for (const o of sim.colony.orgs.values()) {
    if (!o.alive || !o.rules.length) continue
    const rules = o.size >= FREE_GROWTH_SIZE ? o.rules.filter((r) => !makesLifeFromNonFood(r)) : o.rules
    if (rules.length) orgRules.set(o.id, rules.map(compile))
  }
  step(sim.world, sim.compiled, orgRules)
  if (sim.world.tick % IDENTITY_EVERY === 0) {
    divideOversized(sim.world, sim.colony)
    updateOrganisms(sim.world, sim.colony)
    sim.edges = adjacency(sim.world, sim.colony)
    const minds = new Set(activeMinds(sim.colony).map((o) => o.id))
    settleBirths(sim.colony.feed, (id) => minds.has(id), MAX_MINDS)
  }
}

function deliver(sim: Sim, org: Organism, reply: MindReply): void {
  const rulesBefore = org.rules
  const saidBefore = org.lexicon
  applyReply(org, reply)
  const tick = sim.world.tick
  if (reply.rules.length) for (const r of newRules(rulesBefore, org.rules).slice(0, 2)) pushFeed(sim.colony.feed, tick, 'rule', org.id, ruleText(org.id, r))
  const others = new Set<string>()
  for (const o of sim.colony.orgs.values()) if (o.alive && o !== org) for (const w of o.lexicon) others.add(w)
  const fresh = words(reply.say).filter((w) => !INITIAL_VOCAB.has(w))
  for (const w of adoptedWords(saidBefore, fresh, others)) pushFeed(sim.colony.feed, tick, 'word', org.id, wordText(org.id, w))
  if (reply.thought) {
    org.bubble = reply.thought
    org.bubbleUntil = sim.clock + BUBBLE_MS
  }
  org.whisper = ''
  if (reply.thought) sim.thoughts = [...sim.thoughts, { id: org.id, tick: sim.world.tick, text: reply.thought }].slice(-80)
  if (!reply.say) return
  // Speech only reaches minds whose bodies touch this one.
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
      const reply = demoMind(sim.world, org, sim.world.rng)
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
  llmMind(sim.llm, buildMessages(sim.world, org, neighbors), ctl.signal)
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

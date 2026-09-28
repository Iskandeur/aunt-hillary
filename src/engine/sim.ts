// The loop that binds the two time scales: physics every frame, identities every few frames,
// and each active mind thinking every THINK_MS (default ~5 s), asynchronously, between frames.

import { activeMinds, adjacency, createColony, divideOversized, neighborsOf, updateOrganisms, type Colony, type Organism } from './organisms.ts'
import { applyReply, buildMessages, demoMind, llmMind, type LlmConfig, type MindReply } from './mind.ts'
import { DEFAULT_RULES, LIFE, PLANT, SAND, WALL, WATER, compile, createWorld, mulberry32, paint, step, type CRule, type Rule, type World } from './world.ts'

export const THINK_MS = 5000
export const IDENTITY_EVERY = 10

export interface Sim {
  world: World
  colony: Colony
  rules: Rule[]
  compiled: CRule[]
  edges: Array<[number, number]>
  llm: LlmConfig | null
  lastError: string
  thoughts: Array<{ id: number; tick: number; text: string }>
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
  return { world, colony: createColony(), rules, compiled: rules.map(compile), edges: [], llm: null, lastError: '', thoughts: [] }
}

export function setRules(sim: Sim, rules: Rule[]): void {
  sim.rules = rules
  sim.compiled = rules.map(compile)
}

/** One physics frame; every IDENTITY_EVERY frames, re-read who is who. */
export function frame(sim: Sim): void {
  const orgRules = new Map<number, CRule[]>()
  for (const o of sim.colony.orgs.values()) if (o.alive && o.rules.length) orgRules.set(o.id, o.rules.map(compile))
  step(sim.world, sim.compiled, orgRules)
  if (sim.world.tick % IDENTITY_EVERY === 0) {
    divideOversized(sim.world, sim.colony)
    updateOrganisms(sim.world, sim.colony)
    sim.edges = adjacency(sim.world, sim.colony)
  }
}

function deliver(sim: Sim, org: Organism, reply: MindReply): void {
  applyReply(org, reply)
  org.whisper = ''
  if (reply.thought) sim.thoughts = [...sim.thoughts, { id: org.id, tick: sim.world.tick, text: reply.thought }].slice(-80)
  if (!reply.say) return
  // Speech only reaches minds whose bodies touch this one.
  for (const n of neighborsOf(org.id, sim.edges)) {
    const other = sim.colony.orgs.get(n)
    if (other?.alive) other.inbox = [...other.inbox, { from: org.id, text: reply.say, tick: sim.world.tick }].slice(-6)
  }
}

/** Wake the minds whose turn has come. Demo minds answer synchronously; LLM minds resolve later. */
export function think(sim: Sim, now: number, thinkMs = THINK_MS): void {
  const minds = activeMinds(sim.colony)
  minds.forEach((org, k) => {
    if (org.thinking) return
    // Stagger first thoughts so eight minds do not all speak on the same frame.
    if (org.nextThink === 0) org.nextThink = now + (k * thinkMs) / minds.length
    if (now < org.nextThink) return
    org.nextThink = now + thinkMs
    const neighbors = neighborsOf(org.id, sim.edges).map((id) => sim.colony.orgs.get(id)!).filter(Boolean)
    if (!sim.llm) {
      deliver(sim, org, demoMind(sim.world, org, sim.world.rng))
      return
    }
    org.thinking = true
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 30000)
    llmMind(sim.llm, buildMessages(sim.world, org, neighbors), ctl.signal)
      .then(({ reply, errors }) => {
        if (errors.length) sim.lastError = `#${org.id}: ${errors[0]}`
        if (reply && org.alive) deliver(sim, org, reply)
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
      })
  })
}

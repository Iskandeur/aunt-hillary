// Aunt Hillary's rule: no cell thinks. A connected region of life cells that grows big enough
// becomes an organism, and an organism is what gets a mind. Identity is carried by the `owner`
// label on each cell, so fusion, division and death fall out of re-labelling connected components.
// Each body also carries what makes it someone: energy it must earn, a temperament it inherited,
// and the story of its own life.

import { EMPTY, LIFE, PLANT, type Heading, type Rule, type World } from './world.ts'
import { bornText, createFeed, dissolvedText, dividedText, mergedText, pushFeed, refusedText, starvingText, type Feed } from './feed.ts'

export const MIN_SIZE = 24
/** At 150, one body swallowed every newcomer and hovered just under the line: nobody ever divided. */
export const DIVIDE_SIZE = 90
/** A body born of a division must live this many frames before it grows past DIVIDE_SIZE or splits
 *  again. Without it, eating-while-growing paid for itself, each half inherited the habit, and a
 *  colony went from one body to hundreds in five minutes, then starved. */
export const MATURE_AGE = 600
export const isYoung = (o: Organism, tick: number): boolean => o.parent !== null && tick - o.born < MATURE_AGE
export const MAX_MINDS = 8

// ---------------------------------------------------------------- energy (what is at stake)

/** A newborn body starts with this much energy per cell. */
export const START_ENERGY = 1
/** Living costs energy every identity update, in proportion to size. */
export const UPKEEP = 0.012
/** Eating one plant cell. */
export const PLANT_ENERGY = 3
/** Making one new life cell out of anything. */
export const GROW_COST = 2
/** Moving one cell forward. */
export const MOVE_COST = 0.04
/** Energy a body can store, per cell. */
export const MAX_ENERGY_PER_CELL = 4
/** A starving body (energy 0) loses this share of its cells per identity update; they turn to plants. */
export const STARVE_LOSS = 0.08

// ---------------------------------------------------------------- temperament (what it inherited)

export const TRAITS = ['curiosity', 'greed', 'sociability', 'caution'] as const
export type Trait = (typeof TRAITS)[number]
export type Temperament = Record<Trait, number>
/** How far a child's trait can drift from its parent's at division. */
export const MUTATION = 0.15

const clamp01 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100

export function randomTemperament(rng: () => number): Temperament {
  return Object.fromEntries(TRAITS.map((t) => [t, clamp01(rng())])) as Temperament
}

export function mutate(t: Temperament, rng: () => number, amount = MUTATION): Temperament {
  return Object.fromEntries(TRAITS.map((k) => [k, clamp01(t[k] + (rng() * 2 - 1) * amount)])) as Temperament
}

/** Fusion blends two natures, weighted by how much of the new body each brought. */
export function blend(a: Temperament, wa: number, b: Temperament, wb: number): Temperament {
  return Object.fromEntries(TRAITS.map((k) => [k, clamp01((a[k] * wa + b[k] * wb) / (wa + wb || 1))])) as Temperament
}

// ---------------------------------------------------------------- organisms

export interface Message {
  from: number
  text: string
  tick: number
}

export interface Organism {
  id: number
  parent: number | null
  gen: number
  born: number
  alive: boolean
  /** How it ended: 'divided', 'merged into #n', 'dissolved', 'starved'. */
  fate: string
  size: number
  cx: number
  cy: number
  rules: Rule[]
  /** Short notes the mind chose to keep (deduplicated). */
  memory: string[]
  /** What actually happened to it, written by the world, not by the mind. */
  diary: string[]
  /** Who it says it is: rewritten by the mind at every thought, inherited by its children. */
  self: string
  temperament: Temperament
  energy: number
  /** Whether it lets touching bodies fuse with it. Both sides must accept. */
  fusion: 'accept' | 'refuse'
  /** Where the body is walking, or null to stay put. */
  heading: Heading | null
  hungry: boolean
  thought: string
  say: string
  inbox: Message[]
  /** Every word this organism has itself said (for the conventions metric). */
  lexicon: string[]
  hue: number
  nextThink: number
  thinking: boolean
  whisper: string
  /** Last thought shown as a bubble on the canvas until bubbleUntil (sim clock). */
  bubble: string
  bubbleUntil: number
}

export interface Colony {
  orgs: Map<number, Organism>
  nextId: number
  events: string[]
  /** The same story in plain sentences, for the "What's happening" panel. */
  feed: Feed
  /** Pairs of bodies that touched while one refused fusion (logged once per pair). */
  refusals: Set<string>
}

export const createColony = (): Colony => ({ orgs: new Map(), nextId: 1, events: [], feed: createFeed(), refusals: new Set() })

export const DIARY_MAX = 10
export const MEMORY_MAX = 6

export function note(o: Organism, tick: number, text: string): void {
  if (o.diary[o.diary.length - 1]?.endsWith(text)) return
  o.diary = [...o.diary, `t${tick}: ${text}`].slice(-DIARY_MAX)
}

export function newOrganism(colony: Colony, tick: number, parent: Organism | null, rng: () => number): Organism {
  const id = colony.nextId++
  const temperament = parent ? mutate(parent.temperament, rng) : randomTemperament(rng)
  const o: Organism = {
    id,
    parent: parent ? parent.id : null,
    gen: parent ? parent.gen + 1 : 0,
    born: tick,
    alive: true,
    fate: '',
    size: 0,
    cx: 0,
    cy: 0,
    // Division = reproduction: children inherit the body's rules, notes, story and self-image.
    rules: parent ? parent.rules.map((r) => ({ ...r })) : [],
    memory: parent ? [...parent.memory] : [],
    diary: parent ? [...parent.diary] : [],
    self: parent ? parent.self : '',
    temperament,
    energy: 0,
    fusion: temperament.caution > 0.6 && temperament.sociability < 0.5 ? 'refuse' : 'accept',
    heading: null,
    hungry: false,
    thought: '',
    say: '',
    inbox: [],
    lexicon: [],
    hue: parent ? (parent.hue + 25 + rng() * 40) % 360 : Math.floor(rng() * 360),
    nextThink: 0,
    thinking: false,
    whisper: '',
    bubble: '',
    bubbleUntil: 0,
  }
  colony.orgs.set(id, o)
  return o
}

export interface Component {
  cells: number[]
  owners: Map<number, number>
}

/**
 * Bodies are connected regions of life cells. Two touching cells of different bodies belong to one
 * region only if both bodies accept fusion (`joins`). Loose cells (owned by nobody) form their own
 * regions, then stick to the first body they touch. `refused` collects pairs that touched without
 * joining.
 */
export function components(world: World, joins: (a: number, b: number) => boolean = () => true, refused?: Set<string>): Component[] {
  const { w, h, cells, owner } = world
  const n = w * h
  const comp = new Int32Array(n).fill(-1)
  const out: Component[] = []
  const stack: number[] = []
  const nbrs = (i: number) => {
    const x = i % w, y = (i / w) | 0
    return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
  }
  const flood = (s: number, owned: boolean) => {
    const c: Component = { cells: [], owners: new Map() }
    const k = out.length
    comp[s] = k
    stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      c.cells.push(i)
      if (owner[i] >= 0) c.owners.set(owner[i], (c.owners.get(owner[i]) ?? 0) + 1)
      for (const j of nbrs(i)) {
        if (j < 0 || comp[j] >= 0 || cells[j] !== LIFE) continue
        if (owned !== owner[j] >= 0) continue
        if (owned && owner[j] !== owner[i] && !joins(owner[i], owner[j])) {
          if (refused) refused.add(owner[i] < owner[j] ? `${owner[i]},${owner[j]}` : `${owner[j]},${owner[i]}`)
          continue
        }
        comp[j] = k
        stack.push(j)
      }
    }
    out.push(c)
  }
  for (let s = 0; s < n; s++) if (comp[s] < 0 && cells[s] === LIFE && owner[s] >= 0) flood(s, true)
  const bodies = out.length
  for (let s = 0; s < n; s++) if (comp[s] < 0 && cells[s] === LIFE) flood(s, false)
  // A loose region touching a body is part of it.
  for (let k = out.length - 1; k >= bodies; k--) {
    let host = -1
    for (const i of out[k].cells) {
      host = nbrs(i).find((j) => j >= 0 && comp[j] >= 0 && comp[j] < bodies) ?? -1
      if (host >= 0) {
        host = comp[host]
        break
      }
    }
    if (host < 0) continue
    for (const i of out[k].cells) (comp[i] = host), out[host].cells.push(i)
    out.splice(k, 1)
  }
  return out
}

function dominant(owners: Map<number, number>): number {
  let best = -1, bestN = 0
  for (const [id, n] of owners) if (n > bestN || (n === bestN && id < best)) (best = id), (bestN = n)
  return best
}

/** Both bodies must accept for their cells to fuse. */
export function consentJoin(colony: Colony): (a: number, b: number) => boolean {
  return (a, b) => {
    const A = colony.orgs.get(a), B = colony.orgs.get(b)
    if (!A?.alive || !B?.alive) return true
    return A.fusion === 'accept' && B.fusion === 'accept'
  }
}

/**
 * Re-read the grid and update identities. Returns nothing; mutates colony + world.owner.
 * - a big component with no owner is born (cells fused into a body);
 * - two big components claiming the same owner are a division: the parent ends, two children start;
 * - a component holding several owners is a fusion (both consented): the dominant one absorbs the other;
 * - an owner whose body fell below MIN_SIZE dissolves.
 */
export function updateOrganisms(world: World, colony: Colony, rng: () => number = world.rng): void {
  const { w, owner } = world
  const refused = new Set<string>()
  const comps = components(world, consentJoin(colony), refused).filter((c) => c.cells.length >= MIN_SIZE)
  for (const pair of refused) {
    if (colony.refusals.has(pair)) continue
    colony.refusals.add(pair)
    const [a, b] = pair.split(',').map((x) => colony.orgs.get(Number(x))!)
    const who = a.fusion === 'refuse' ? a : b
    const other = who === a ? b : a
    note(who, world.tick, `touched #${other.id} and refused to fuse`)
    note(other, world.tick, `touched #${who.id}, who refused to fuse`)
    pushFeed(colony.feed, world.tick, 'refused', who.id, refusedText(who.id, other.id))
  }
  const claims = new Map<number, Component[]>()
  for (const c of comps) {
    const d = dominant(c.owners)
    if (d >= 0 && colony.orgs.get(d)?.alive) claims.set(d, [...(claims.get(d) ?? []), c])
  }
  const label = new Map<Component, Organism>()
  for (const [id, cs] of claims) {
    const parent = colony.orgs.get(id)!
    if (cs.length === 1) label.set(cs[0], parent)
    else {
      parent.alive = false
      parent.fate = 'divided'
      const total = cs.reduce((s, c) => s + c.cells.length, 0)
      const kids = cs.map((c) => {
        const kid = newOrganism(colony, world.tick, parent, rng)
        kid.energy = (parent.energy * c.cells.length) / total
        label.set(c, kid)
        return kid.id
      })
      for (const c of cs) {
        const kid = label.get(c)!
        const sibs = kids.filter((k) => k !== kid.id).map((k) => '#' + k).join(', ')
        note(kid, world.tick, `I was born when #${parent.id} split in ${cs.length}; my sibling: ${sibs}`)
      }
      colony.events.push(`#${parent.id} divided into ${kids.map((k) => '#' + k).join(' + ')}`)
      const heir = [...cs].sort((a, b) => b.cells.length - a.cells.length)[0]
      pushFeed(colony.feed, world.tick, 'divided', label.get(heir)!.id, dividedText(parent.id, kids))
    }
  }
  for (const c of comps) {
    if (!label.has(c)) {
      const o = newOrganism(colony, world.tick, null, rng)
      o.energy = c.cells.length * START_ENERGY
      note(o, world.tick, 'I woke up when loose cells fused into one body')
      colony.events.push(`#${o.id} awoke (${c.cells.length} cells fused)`)
      pushFeed(colony.feed, world.tick, 'born', o.id, bornText(o.id, c.cells.length))
      label.set(c, o)
    }
  }
  const labelled = new Set([...label.values()].map((o) => o.id))
  for (const c of comps) {
    const o = label.get(c)!
    // Fusion: a living owner present in this body that won no body of its own is absorbed.
    for (const [id, n] of c.owners) {
      const other = colony.orgs.get(id)
      if (!other || other === o || !other.alive || labelled.has(id)) continue
      other.alive = false
      other.fate = `merged into #${o.id}`
      o.temperament = blend(o.temperament, c.cells.length - n, other.temperament, n)
      o.energy += other.energy
      note(o, world.tick, `fused with #${other.id} and took in its memories`)
      o.memory = dedupe([...o.memory, ...other.memory.slice(-2).map((m) => `(from #${other.id}) ${m}`)])
      colony.events.push(`#${other.id} merged into #${o.id}`)
      pushFeed(colony.feed, world.tick, 'merged', o.id, mergedText(other.id, o.id))
    }
    let sx = 0, sy = 0
    for (const i of c.cells) {
      owner[i] = o.id
      sx += i % w
      sy += (i / w) | 0
    }
    o.size = c.cells.length
    o.cx = sx / c.cells.length
    o.cy = sy / c.cells.length
    o.memory = o.memory.slice(-MEMORY_MAX)
  }
  // Loose cells and small fragments belong to nobody.
  const live = new Set([...label.values()].map((o) => o.id))
  for (let i = 0; i < owner.length; i++) if (owner[i] >= 0 && !live.has(owner[i])) owner[i] = -1
  for (const o of colony.orgs.values())
    if (o.alive && !live.has(o.id)) {
      o.alive = false
      o.fate = o.energy <= 0 ? 'starved' : 'dissolved'
      colony.events.push(`#${o.id} ${o.fate}`)
      pushFeed(colony.feed, world.tick, 'dissolved', o.id, dissolvedText(o.id, MIN_SIZE, o.fate === 'starved'))
    }
  colony.events = colony.events.slice(-30)
}

/** Drop notes that say again what a newer note says (same words, give or take a few). */
export function dedupe(lines: string[]): string[] {
  const bag = (l: string) => new Set(l.toLowerCase().match(/[a-z]{3,}/g) ?? [])
  const out: string[] = []
  const kept: Array<Set<string>> = []
  for (const l of [...lines].reverse()) {
    const b = bag(l)
    const same = kept.some((k) => {
      let n = 0
      for (const x of b) if (k.has(x)) n++
      return n / Math.max(1, Math.min(b.size, k.size)) >= 0.6
    })
    if (!same) kept.push(b), out.unshift(l)
  }
  return out
}

/**
 * The metabolism, run every identity update: living costs energy in proportion to size; a body
 * with none left loses cells (they turn to plants, food for others) until it falls apart.
 */
export function metabolize(world: World, colony: Colony): void {
  const { owner, cells, rng } = world
  const starving = new Map<number, number>()
  for (const o of colony.orgs.values()) {
    if (!o.alive) continue
    o.energy = Math.min(o.size * MAX_ENERGY_PER_CELL, o.energy - o.size * UPKEEP)
    if (o.energy <= 0) {
      o.energy = 0
      starving.set(o.id, Math.max(1, Math.ceil(o.size * STARVE_LOSS)))
      if (!o.hungry || !o.diary.some((d) => d.endsWith('starving: my cells are dying'))) {
        note(o, world.tick, 'starving: my cells are dying')
        pushFeed(colony.feed, world.tick, 'hunger', o.id, starvingText(o.id))
      }
      o.hungry = true
    } else if (o.energy < o.size * 0.3 && !o.hungry) {
      o.hungry = true
      note(o, world.tick, 'hungry: my energy is running low')
    } else if (o.energy > o.size * 0.6 && o.hungry) {
      o.hungry = false
      note(o, world.tick, 'fed again')
    }
  }
  if (!starving.size) return
  for (let i = 0; i < owner.length; i++) {
    const loss = starving.get(owner[i])
    if (!loss) continue
    if (rng() < loss / Math.max(1, colony.orgs.get(owner[i])!.size)) {
      cells[i] = rng() < 0.5 ? PLANT : EMPTY
      owner[i] = -1
    }
  }
}

/** Who carries on a body that is gone: the organism it merged into, or its largest living child
 *  after a division (followed down the line). A thought that returns after its thinker changed
 *  identity lands on the heir instead of being lost. Dissolved bodies have no heir. */
export function heirOf(colony: Colony, org: Organism, depth = 0): Organism | null {
  if (org.alive) return org
  if (depth > 32) return null
  const merged = org.fate.match(/^merged into #(\d+)$/)
  if (merged) {
    const into = colony.orgs.get(Number(merged[1]))
    return into ? heirOf(colony, into, depth + 1) : null
  }
  if (org.fate === 'divided') {
    const kids = [...colony.orgs.values()].filter((o) => o.parent === org.id).sort((a, b) => b.size - a.size)
    for (const k of kids) {
      const h = heirOf(colony, k, depth + 1)
      if (h) return h
    }
  }
  return null
}

/** Growth past DIVIDE_SIZE cuts a grown-up body in two along its longer axis; the next update sees two. */
export function divideOversized(world: World, colony: Colony): number[] {
  const { w, cells, owner } = world
  const cut: number[] = []
  for (const o of colony.orgs.values()) {
    if (!o.alive || o.size <= DIVIDE_SIZE) continue
    if (isYoung(o, world.tick)) continue
    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== o.id) continue
      const x = i % w, y = (i / w) | 0
      minX = Math.min(minX, x), maxX = Math.max(maxX, x), minY = Math.min(minY, y), maxY = Math.max(maxY, y)
    }
    const vertical = maxX - minX >= maxY - minY
    const mid = vertical ? Math.round((minX + maxX) / 2) : Math.round((minY + maxY) / 2)
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== o.id) continue
      const x = i % w, y = (i / w) | 0
      if ((vertical ? x : y) === mid) (cells[i] = EMPTY), (owner[i] = -1)
    }
    cut.push(o.id)
  }
  return cut
}

/** Minds are scarce: only the MAX_MINDS largest living organisms think. */
export function activeMinds(colony: Colony): Organism[] {
  return [...colony.orgs.values()]
    .filter((o) => o.alive)
    .sort((a, b) => b.size - a.size || a.id - b.id)
    .slice(0, MAX_MINDS)
}

/** Two organisms are neighbours when their bodies come within `radius` cells. The graph is born of space. */
export function adjacency(world: World, colony: Colony, radius = 3): Array<[number, number]> {
  const { w, h, owner } = world
  const pairs = new Set<string>()
  for (let i = 0; i < owner.length; i++) {
    const a = owner[i]
    if (a < 0) continue
    const x = i % w, y = (i / w) | 0
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const b = owner[ny * w + nx]
        if (b > a && colony.orgs.get(a)?.alive && colony.orgs.get(b)?.alive) pairs.add(`${a},${b}`)
      }
  }
  return [...pairs].map((p) => p.split(',').map(Number) as [number, number])
}

export function neighborsOf(id: number, edges: Array<[number, number]>): number[] {
  return edges.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []))
}

export function lineage(colony: Colony, id: number): number[] {
  const chain: number[] = []
  let cur = colony.orgs.get(id)
  while (cur) {
    chain.push(cur.id)
    cur = cur.parent != null ? colony.orgs.get(cur.parent) : undefined
  }
  return chain
}

/** How b is related to a, in the words a mind reads: "your sibling", "your parent", "your child",
 *  "your kin" (a common ancestor further up), or '' for a stranger. Bodies that split are born side by
 *  side, so kin start out as neighbours; whether they stay close is up to them. */
export function kinship(colony: Colony, a: Organism, b: Organism): string {
  if (a.parent != null && a.parent === b.parent) return 'your sibling'
  if (a.parent === b.id) return 'your parent'
  if (b.parent === a.id) return 'your child'
  const up = new Set(lineage(colony, a.id))
  return lineage(colony, b.id).some((id) => up.has(id)) ? 'your kin' : ''
}

/** Largest trait drift from the root of a lineage to this body (0 = same nature as its ancestor). */
export function drift(colony: Colony, id: number): number {
  const chain = lineage(colony, id).map((k) => colony.orgs.get(k)!)
  const a = chain[0], z = chain[chain.length - 1]
  if (!a || !z) return 0
  return Math.max(...TRAITS.map((t) => Math.abs(a.temperament[t] - z.temperament[t])))
}

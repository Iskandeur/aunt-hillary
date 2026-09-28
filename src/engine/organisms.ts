// Aunt Hillary's rule: no cell thinks. A connected region of life cells that grows big enough
// becomes an organism, and an organism is what gets a mind. Identity is carried by the `owner`
// label on each cell, so fusion, division and death fall out of re-labelling connected components.

import { EMPTY, LIFE, type Rule, type World } from './world.ts'

export const MIN_SIZE = 24
export const DIVIDE_SIZE = 150
export const MAX_MINDS = 8

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
  /** How it ended: 'divided', 'merged into #n', 'dissolved'. */
  fate: string
  size: number
  cx: number
  cy: number
  rules: Rule[]
  memory: string[]
  thought: string
  say: string
  inbox: Message[]
  /** Every word this organism has itself said (for the conventions metric). */
  lexicon: string[]
  hue: number
  nextThink: number
  thinking: boolean
  whisper: string
}

export interface Colony {
  orgs: Map<number, Organism>
  nextId: number
  events: string[]
}

export const createColony = (): Colony => ({ orgs: new Map(), nextId: 1, events: [] })

function newOrganism(colony: Colony, tick: number, parent: Organism | null, rng: () => number): Organism {
  const id = colony.nextId++
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
    // Division = reproduction: children inherit the body's rules and the parent's memory.
    rules: parent ? parent.rules.map((r) => ({ ...r })) : [],
    memory: parent ? [...parent.memory] : [],
    thought: '',
    say: '',
    inbox: [],
    lexicon: [],
    hue: parent ? (parent.hue + 25 + rng() * 40) % 360 : Math.floor(rng() * 360),
    nextThink: 0,
    thinking: false,
    whisper: '',
  }
  colony.orgs.set(id, o)
  return o
}

interface Component {
  cells: number[]
  owners: Map<number, number>
}

export function components(world: World): Component[] {
  const { w, h, cells, owner } = world
  const seen = new Uint8Array(w * h)
  const out: Component[] = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || cells[s] !== LIFE) continue
    const comp: Component = { cells: [], owners: new Map() }
    seen[s] = 1
    stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      comp.cells.push(i)
      if (owner[i] >= 0) comp.owners.set(owner[i], (comp.owners.get(owner[i]) ?? 0) + 1)
      const x = i % w, y = (i / w) | 0
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
      for (const j of next) if (j >= 0 && !seen[j] && cells[j] === LIFE) (seen[j] = 1), stack.push(j)
    }
    out.push(comp)
  }
  return out
}

function dominant(owners: Map<number, number>): number {
  let best = -1, bestN = 0
  for (const [id, n] of owners) if (n > bestN || (n === bestN && id < best)) (best = id), (bestN = n)
  return best
}

/**
 * Re-read the grid and update identities. Returns nothing; mutates colony + world.owner.
 * - a big component with no owner is born (cells fused into a body);
 * - two big components claiming the same owner are a division: the parent ends, two children start;
 * - a component holding several owners is a fusion: the dominant one absorbs the others' memory;
 * - an owner whose body fell below MIN_SIZE dissolves.
 */
export function updateOrganisms(world: World, colony: Colony, rng: () => number = world.rng): void {
  const { w, owner } = world
  const comps = components(world).filter((c) => c.cells.length >= MIN_SIZE)
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
      const kids = cs.map((c) => {
        const kid = newOrganism(colony, world.tick, parent, rng)
        kid.memory.push(`I was born when #${parent.id} split in ${cs.length}.`)
        label.set(c, kid)
        return kid.id
      })
      colony.events.push(`#${parent.id} divided into ${kids.map((k) => '#' + k).join(' + ')}`)
    }
  }
  for (const c of comps) {
    if (!label.has(c)) {
      const o = newOrganism(colony, world.tick, null, rng)
      o.memory.push('I woke up when loose cells fused into one body.')
      colony.events.push(`#${o.id} awoke (${c.cells.length} cells fused)`)
      label.set(c, o)
    }
  }
  const labelled = new Set([...label.values()].map((o) => o.id))
  for (const c of comps) {
    const o = label.get(c)!
    // Fusion: a living owner present in this body that won no body of its own is absorbed.
    for (const [id] of c.owners) {
      const other = colony.orgs.get(id)
      if (!other || other === o || !other.alive || labelled.has(id)) continue
      other.alive = false
      other.fate = `merged into #${o.id}`
      o.memory.push(...other.memory.slice(-3).map((m) => `(from #${other.id}) ${m}`))
      colony.events.push(`#${other.id} merged into #${o.id}`)
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
    o.memory = o.memory.slice(-8)
  }
  // Loose cells and small fragments belong to nobody.
  const live = new Set([...label.values()].map((o) => o.id))
  for (let i = 0; i < owner.length; i++) if (owner[i] >= 0 && !live.has(owner[i])) owner[i] = -1
  for (const o of colony.orgs.values())
    if (o.alive && !live.has(o.id)) {
      o.alive = false
      o.fate = 'dissolved'
      colony.events.push(`#${o.id} dissolved`)
    }
  colony.events = colony.events.slice(-30)
}

/** Growth past DIVIDE_SIZE cuts the body in two along its longer axis; the next update sees two. */
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

export function divideOversized(world: World, colony: Colony): number[] {
  const { w, cells, owner } = world
  const cut: number[] = []
  for (const o of colony.orgs.values()) {
    if (!o.alive || o.size <= DIVIDE_SIZE) continue
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

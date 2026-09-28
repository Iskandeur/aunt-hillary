// The zero-token layer: a grid of elements rewritten by local pair rules, CellPond style.
// A rule reads "this cell and that neighbour look like BEFORE, so make them look like AFTER".
// Updates are asynchronous: each step visits cells in random order, one rewrite at a time.
// The world is seen from above: there is no gravity, no up or down, only north, south, east, west.

export const EL_NAMES = ['ground', 'rock', 'grass', 'water', 'plant', 'life'] as const
export type ElName = (typeof EL_NAMES)[number]
export const EMPTY = 0, WALL = 1, GRASS = 2, WATER = 3, PLANT = 4, LIFE = 5

export const DIRS = ['north', 'south', 'east', 'west', 'any'] as const
export type Dir = (typeof DIRS)[number]
export type Heading = Exclude<Dir, 'any'>

export interface Rule {
  self: ElName
  dir: Dir
  neighbor: ElName
  toSelf: ElName
  toNeighbor: ElName
  chance: number
}

export type Rng = () => number

export interface World {
  w: number
  h: number
  cells: Uint8Array
  /** Organism id owning a life cell, -1 when loose. */
  owner: Int32Array
  rng: Rng
  tick: number
  /** Rain: how readily plants sprout on ground or grass next to water (and, rarely, anywhere on grass). */
  rain: number
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const DEFAULT_RAIN = 0.004

export function createWorld(w: number, h: number, rng: Rng = Math.random): World {
  return { w, h, cells: new Uint8Array(w * h), owner: new Int32Array(w * h).fill(-1), rng, tick: 0, rain: 0 }
}

export const el = (name: ElName): number => EL_NAMES.indexOf(name)

/** The physics everyone starts with. Minds never edit these; the player can. */
export const DEFAULT_RULES: Rule[] = [
  // Plants spread slowly across meadows; bare ground slowly turns back to grass.
  { self: 'plant', dir: 'any', neighbor: 'grass', toSelf: 'plant', toNeighbor: 'plant', chance: 0.006 },
  { self: 'grass', dir: 'any', neighbor: 'ground', toSelf: 'grass', toNeighbor: 'grass', chance: 0.004 },
]

export const OFFSETS: Record<Heading, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  west: [-1, 0],
  east: [1, 0],
}
const ALL = [OFFSETS.north, OFFSETS.south, OFFSETS.west, OFFSETS.east]

export function pickOffset(dir: Dir, rng: Rng): [number, number] {
  return dir === 'any' ? ALL[Math.floor(rng() * 4)] : OFFSETS[dir]
}

/** Compiled form: element indices instead of names, so the inner loop never touches strings. */
export interface CRule {
  self: number
  dir: Dir
  neighbor: number
  toSelf: number
  toNeighbor: number
  chance: number
}

export const compile = (r: Rule): CRule => ({
  self: el(r.self),
  dir: r.dir,
  neighbor: el(r.neighbor),
  toSelf: el(r.toSelf),
  toNeighbor: el(r.toNeighbor),
  chance: r.chance,
})

/** What one rewrite did to the body that made it, so the colony can charge or pay its energy. */
export interface Effect {
  /** Plant cells consumed (turned into anything else). */
  ate: number
  /** Life cells made from something that was not life. */
  grew: number
}

/** A body's energy ledger during a sweep: `can(id, cost)` gates growth, `book` records effects. */
export interface Ledger {
  can(id: number, grew: number): boolean
  book(id: number, e: Effect): void
}

/** Try one rule at cell i. Returns true when it fired. */
export function applyRule(world: World, i: number, r: CRule, ledger?: Ledger): boolean {
  const { w, h, cells, owner, rng } = world
  if (cells[i] !== r.self) return false
  const [dx, dy] = pickOffset(r.dir, rng)
  const x = (i % w) + dx
  const y = Math.floor(i / w) + dy
  if (x < 0 || y < 0 || x >= w || y >= h) return false
  const j = y * w + x
  if (cells[j] !== r.neighbor) return false
  // Life cells of another body are not yours to rewrite.
  if (cells[j] === LIFE && cells[i] === LIFE && owner[j] !== owner[i] && owner[j] >= 0 && r.toNeighbor !== LIFE) return false
  if (r.chance < 1 && rng() >= r.chance) return false
  const heir = cells[i] === LIFE ? owner[i] : cells[j] === LIFE ? owner[j] : -1
  const grew = (r.toSelf === LIFE && cells[i] !== LIFE ? 1 : 0) + (r.toNeighbor === LIFE && cells[j] !== LIFE ? 1 : 0)
  const ate = (cells[i] === PLANT && r.toSelf !== PLANT ? 1 : 0) + (cells[j] === PLANT && r.toNeighbor !== PLANT ? 1 : 0)
  if (ledger && heir >= 0 && grew > 0 && !ledger.can(heir, grew)) return false
  cells[i] = r.toSelf
  cells[j] = r.toNeighbor
  // Swaps carry identity with the cell that moved.
  const swapped = r.toSelf === r.neighbor && r.toNeighbor === r.self
  if (swapped) {
    const o = owner[i]
    owner[i] = owner[j]
    owner[j] = o
  } else {
    owner[i] = r.toSelf === LIFE ? heir : -1
    owner[j] = r.toNeighbor === LIFE ? heir : -1
  }
  if (ledger && heir >= 0 && (grew || ate)) ledger.book(heir, { ate, grew })
  return true
}

function nextToWater(world: World, i: number): boolean {
  const { w, h, cells } = world
  const x = i % w, y = (i / w) | 0
  return (
    (x > 0 && cells[i - 1] === WATER) ||
    (x < w - 1 && cells[i + 1] === WATER) ||
    (y > 0 && cells[i - w] === WATER) ||
    (y < h - 1 && cells[i + w] === WATER)
  )
}

/** Loose life cells (owned by no body) wither back into plants: dead matter feeds the living. */
export const LOOSE_DECAY = 0.004

/**
 * One asynchronous sweep: w*h random cell visits. Each visit tries the cell owner's rules first
 * (an organism's self-written physics), then the global rules, and stops at the first that fires.
 * Then the rain: plants sprout next to water, and rarely on open grass.
 */
export function step(world: World, global: CRule[], orgRules: Map<number, CRule[]> = new Map(), ledger?: Ledger): void {
  const { w, h, cells, owner, rng } = world
  const n = w * h
  for (let k = 0; k < n; k++) {
    const i = Math.floor(rng() * n)
    const c = cells[i]
    if (c === EMPTY || c === WALL || c === WATER) continue
    if (c === LIFE) {
      if (owner[i] < 0) {
        if (rng() < LOOSE_DECAY) cells[i] = PLANT
        continue
      }
      const own = orgRules.get(owner[i])
      if (own && own.some((r) => applyRule(world, i, r, ledger))) continue
    }
    for (const r of global) if (applyRule(world, i, r, ledger)) break
  }
  if (world.rain > 0) {
    const tries = Math.ceil(n * world.rain)
    for (let k = 0; k < tries; k++) {
      const i = Math.floor(rng() * n)
      const c = cells[i]
      if (c !== EMPTY && c !== GRASS) continue
      if (nextToWater(world, i) || (c === GRASS && rng() < 0.08)) cells[i] = PLANT
    }
  }
  world.tick++
}

export function paint(world: World, cx: number, cy: number, radius: number, element: number): void {
  const { w, h, cells, owner } = world
  for (let y = cy - radius; y <= cy + radius; y++)
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius + 0.5) continue
      const i = y * w + x
      cells[i] = element
      if (element !== LIFE) owner[i] = -1
    }
}

export function count(world: World, element: number): number {
  let n = 0
  for (const c of world.cells) if (c === element) n++
  return n
}

/** Cells a body can walk onto: open ground, grass, and plants (which it eats on the way). */
export const walkable = (c: number): boolean => c === EMPTY || c === GRASS || c === PLANT

/**
 * Movement, the one rule every body has: `steps` times, a cell on the leading edge advances into
 * a walkable cell ahead and a cell at the back is released as bare ground. Returns plants eaten and
 * cells moved. The body keeps its size; it cannot walk through water, rock or another body.
 */
export function moveBody(world: World, id: number, heading: Heading, steps: number): { moved: number; ate: number } {
  const { w, h, cells, owner, rng } = world
  const [dx, dy] = OFFSETS[heading]
  const mine: number[] = []
  for (let i = 0; i < owner.length; i++) if (owner[i] === id) mine.push(i)
  if (!mine.length) return { moved: 0, ate: 0 }
  const proj = (i: number) => (i % w) * dx + ((i / w) | 0) * dy
  let moved = 0, ate = 0
  for (let s = 0; s < steps; s++) {
    const front: number[] = []
    for (const i of mine) {
      const x = (i % w) + dx, y = ((i / w) | 0) + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const j = y * w + x
      if (walkable(cells[j])) front.push(j)
    }
    if (!front.length) break
    const j = front[Math.floor(rng() * front.length)]
    // The back cell: the rearmost along the heading (ties broken at random).
    let min = Infinity
    for (const i of mine) min = Math.min(min, proj(i))
    const back = mine.filter((i) => proj(i) === min)
    const b = back[Math.floor(rng() * back.length)]
    if (cells[j] === PLANT) ate++
    cells[j] = LIFE
    owner[j] = id
    cells[b] = EMPTY
    owner[b] = -1
    mine[mine.indexOf(b)] = j
    moved++
  }
  return { moved, ate }
}

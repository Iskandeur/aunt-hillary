// The zero-token layer: a grid of elements rewritten by local pair rules, CellPond style.
// A rule reads "this cell and that neighbour look like BEFORE, so make them look like AFTER".
// Updates are asynchronous: each step visits cells in random order, one rewrite at a time.

export const EL_NAMES = ['empty', 'wall', 'sand', 'water', 'plant', 'life'] as const
export type ElName = (typeof EL_NAMES)[number]
export const EMPTY = 0, WALL = 1, SAND = 2, WATER = 3, PLANT = 4, LIFE = 5

export const DIRS = ['up', 'down', 'left', 'right', 'side', 'diag', 'any'] as const
export type Dir = (typeof DIRS)[number]

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

export function createWorld(w: number, h: number, rng: Rng = Math.random): World {
  return { w, h, cells: new Uint8Array(w * h), owner: new Int32Array(w * h).fill(-1), rng, tick: 0, rain: 0 }
}

export const el = (name: ElName): number => EL_NAMES.indexOf(name)

/** The physics everyone starts with. Minds never edit these; the player can. */
export const DEFAULT_RULES: Rule[] = [
  { self: 'sand', dir: 'down', neighbor: 'empty', toSelf: 'empty', toNeighbor: 'sand', chance: 1 },
  { self: 'sand', dir: 'down', neighbor: 'water', toSelf: 'water', toNeighbor: 'sand', chance: 1 },
  { self: 'sand', dir: 'diag', neighbor: 'empty', toSelf: 'empty', toNeighbor: 'sand', chance: 1 },
  { self: 'water', dir: 'down', neighbor: 'empty', toSelf: 'empty', toNeighbor: 'water', chance: 1 },
  { self: 'water', dir: 'diag', neighbor: 'empty', toSelf: 'empty', toNeighbor: 'water', chance: 1 },
  { self: 'water', dir: 'side', neighbor: 'empty', toSelf: 'empty', toNeighbor: 'water', chance: 1 },
  { self: 'plant', dir: 'any', neighbor: 'water', toSelf: 'plant', toNeighbor: 'plant', chance: 0.04 },
  { self: 'life', dir: 'any', neighbor: 'plant', toSelf: 'life', toNeighbor: 'life', chance: 0.05 },
  { self: 'life', dir: 'any', neighbor: 'water', toSelf: 'life', toNeighbor: 'empty', chance: 0.01 },
]

const OFFSETS: Record<Exclude<Dir, 'side' | 'diag' | 'any'>, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

export function pickOffset(dir: Dir, rng: Rng): [number, number] {
  switch (dir) {
    case 'side':
      return rng() < 0.5 ? [-1, 0] : [1, 0]
    case 'diag':
      return rng() < 0.5 ? [-1, 1] : [1, 1]
    case 'any': {
      const all = [OFFSETS.up, OFFSETS.down, OFFSETS.left, OFFSETS.right]
      return all[Math.floor(rng() * 4)]
    }
    default:
      return OFFSETS[dir]
  }
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

/** Try one rule at cell i. Returns true when it fired. */
export function applyRule(world: World, i: number, r: CRule): boolean {
  const { w, h, cells, owner, rng } = world
  if (cells[i] !== r.self) return false
  const [dx, dy] = pickOffset(r.dir, rng)
  const x = (i % w) + dx
  const y = Math.floor(i / w) + dy
  if (x < 0 || y < 0 || x >= w || y >= h) return false
  const j = y * w + x
  if (cells[j] !== r.neighbor) return false
  if (r.chance < 1 && rng() >= r.chance) return false
  // A life cell produced by a rewrite belongs to whoever was alive in the pair (self first).
  const heir = cells[i] === LIFE ? owner[i] : cells[j] === LIFE ? owner[j] : -1
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
  return true
}

function hasLifeNeighbor(world: World, i: number): boolean {
  const { w, h, cells } = world
  const x = i % w, y = Math.floor(i / w)
  return (
    (x > 0 && cells[i - 1] === LIFE) ||
    (x < w - 1 && cells[i + 1] === LIFE) ||
    (y > 0 && cells[i - w] === LIFE) ||
    (y < h - 1 && cells[i + w] === LIFE)
  )
}

const LOOSE_LIFE: CRule[] = [
  compile({ self: 'life', dir: 'down', neighbor: 'empty', toSelf: 'empty', toNeighbor: 'life', chance: 1 }),
  compile({ self: 'life', dir: 'down', neighbor: 'water', toSelf: 'water', toNeighbor: 'life', chance: 1 }),
]

/**
 * One asynchronous sweep: w*h random cell visits. Each visit tries the cell owner's rules first
 * (an organism's self-written physics), then the global rules, and stops at the first that fires.
 */
export function step(world: World, global: CRule[], orgRules: Map<number, CRule[]> = new Map()): void {
  const { w, h, cells, owner, rng } = world
  const n = w * h
  for (let k = 0; k < n; k++) {
    const i = Math.floor(rng() * n)
    const c = cells[i]
    if (c === EMPTY || c === WALL) continue
    if (c === LIFE) {
      // A lone life cell has nothing to hold on to: it falls like sand.
      if (!hasLifeNeighbor(world, i)) {
        if (applyRule(world, i, LOOSE_LIFE[0]) || applyRule(world, i, LOOSE_LIFE[1])) continue
      }
      const own = owner[i] >= 0 ? orgRules.get(owner[i]) : undefined
      if (own && own.some((r) => applyRule(world, i, r))) continue
    }
    for (const r of global) if (applyRule(world, i, r)) break
  }
  if (world.rain > 0) {
    for (let x = 0; x < w; x++) if (cells[x] === EMPTY && rng() < world.rain) cells[x] = WATER
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

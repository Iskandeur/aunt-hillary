// A mind sees only its neighbourhood, hears only nearby minds, and acts only through its body:
// walking, writing rules for its own cells, speaking, giving energy, consenting to fusion.
// Everything it returns is parsed, validated and bounded before it touches the world.
// The prompt describes the physics and never a strategy: minds find out what works.

import { DIRS, EL_NAMES, EMPTY, GRASS, LIFE, PLANT, WALL, WATER, type Dir, type ElName, type Heading, type Rule, type World } from './world.ts'
import { DIVIDE_SIZE, MAX_ENERGY_PER_CELL, MIN_SIZE, TRAITS, dedupe, kinship, lineage, type Colony, type Organism, type Temperament } from './organisms.ts'
import { COMMON_ENGLISH } from './english.ts'

export const MAX_RULES = 4
export const MAX_CHANCE = 0.5
const BODY_ELEMENTS: ElName[] = ['ground', 'grass', 'water', 'plant', 'life']
const HEADINGS: Heading[] = ['north', 'south', 'east', 'west']
/** Words for the self-portrait. */
export const SELF_WORDS = 25

export const SYSTEM_PROMPT = `You are a mind that emerged from a colony of cells in a 2D world seen from above.
No single cell of yours thinks; together, you do. You see your surroundings as an ASCII map (north at the top):
'o' your own body, 'x' another body, ',' grass, '~' water, '*' plant, '#' rock, ' ' bare ground.
How the world works. Your body has energy. Being alive costs energy all the time, more the bigger you are.
A plant cell that your body takes in or destroys gives energy; making a new cell of yourself costs energy.
At zero energy your cells die one by one, and under ${MIN_SIZE} cells you are no longer a body. Plants sprout next
to water and spread over grass. A body over ${DIVIDE_SIZE} cells splits in two; each half inherits your rules, notes,
story and nature, and must live a while before it grows that big again. Two bodies that touch fuse into one only if both accept.
What you can do each time you think:
- move: walk "north", "south", "east" or "west" (you cannot cross water, rock or other bodies), or null to stay;
- rules: up to 4 rules for your own cells. A rule rewrites a pair: one of your cells ("self" is always "life")
  and the neighbour cell in direction dir (north, south, east, west, any). If that neighbour is "neighbor",
  the pair becomes toSelf + toNeighbor with probability chance (max 0.5); life grows only onto plants.
  Elements: ground, grass, water, plant, life;
- say: one short line, heard only by bodies near you;
- give: energy to a body near you, {"to":<id>,"amount":<number>};
- fusion: "accept" or "refuse";
- remember: one short note to keep;
- self: who you are, in your own words, starting with "I am".
Reply with JSON only:
{"thought":"<=20 words","self":"I am ... (<=25 words)","say":"<=12 words","remember":"<=15 words","move":null,"fusion":"accept","give":null,"rules":[]}`

const GLYPH: Record<number, string> = { [EMPTY]: ' ', [WALL]: '#', [GRASS]: ',', [WATER]: '~', [PLANT]: '*' }

export function asciiView(world: World, org: Organism, radius = 8): string {
  const rows: string[] = []
  const cx = Math.round(org.cx), cy = Math.round(org.cy)
  for (let y = cy - radius; y <= cy + radius; y++) {
    let row = ''
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) {
        row += '#'
        continue
      }
      const i = y * world.w + x
      const c = world.cells[i]
      row += c === LIFE ? (world.owner[i] === org.id ? 'o' : 'x') : GLYPH[c]
    }
    rows.push('|' + row + '|')
  }
  return rows.join('\n')
}

const TRAIT_WORDS: Record<(typeof TRAITS)[number], [string, string, string]> = {
  curiosity: ['incurious', 'somewhat curious', 'very curious'],
  greed: ['frugal', 'somewhat greedy', 'very greedy'],
  sociability: ['solitary', 'somewhat sociable', 'very sociable'],
  caution: ['reckless', 'somewhat cautious', 'very cautious'],
}

/** A temperament in words, e.g. "very curious (0.82), frugal (0.10), …". */
export function describeTemperament(t: Temperament): string {
  return TRAITS.map((k) => `${TRAIT_WORDS[k][t[k] < 0.34 ? 0 : t[k] < 0.67 ? 1 : 2]} (${t[k].toFixed(2)})`).join(', ')
}

export function energyLine(org: Organism): string {
  const max = org.size * MAX_ENERGY_PER_CELL
  const state = org.energy <= 0 ? ' You are starving: your cells are dying.' : org.hungry ? ' You are hungry.' : ''
  return `Energy ${Math.round(org.energy)} (you can hold ${max}).${state}`
}

/** Neighbours are shown with their kinship when the colony is known (see kinship in organisms.ts). */
export function buildMessages(world: World, org: Organism, neighbors: Organism[], colony?: Colony): Array<{ role: string; content: string }> {
  const heard = org.inbox.slice(-4).map((m) => `#${m.from}: "${m.text}"`).join('\n') || '(silence)'
  const tag = (n: Organism) => [colony ? kinship(colony, org, n) : '', n.fusion === 'refuse' ? 'refuses fusion' : ''].filter(Boolean).map((s) => ', ' + s).join('')
  const near = neighbors.map((n) => `#${n.id} (${n.size} cells${tag(n)})`).join(', ') || 'none'
  const user = [
    `You are #${org.id}, generation ${org.gen}, ${org.size} cells. Time ${world.tick}. ${energyLine(org)}`,
    `Your nature (inherited, not chosen): ${describeTemperament(org.temperament)}.`,
    `Who you last said you are: ${org.self ? `"${org.self}"` : '(you have not said yet)'}`,
    `What has happened to you:\n${org.diary.map((m) => '- ' + m).join('\n') || '(nothing yet)'}`,
    `Your notes:\n${org.memory.map((m) => '- ' + m).join('\n') || '(none)'}`,
    `Your current rules: ${JSON.stringify(org.rules)}. Walking: ${org.heading ?? 'no'}. Fusion: ${org.fusion}.`,
    `Bodies near you: ${near}`,
    `You heard:\n${heard}`,
    org.whisper ? `A voice from outside the world whispers: "${org.whisper}"` : '',
    `Your surroundings:\n${asciiView(world, org)}`,
  ]
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user.filter(Boolean).join('\n\n') },
  ]
}

export interface MindReply {
  thought: string
  say: string
  remember: string
  rules: Rule[]
  /** "I am…": who the mind says it is. '' keeps the previous one. */
  self?: string
  /** A heading, null to stop, undefined to keep walking as before. */
  move?: Heading | null
  fusion?: 'accept' | 'refuse'
  give?: { to: number; amount: number } | null
}

const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')
const ALIAS: Record<string, Dir> = { up: 'north', down: 'south', left: 'west', right: 'east', n: 'north', s: 'south', e: 'east', w: 'west' }
const ELEMENT_ALIAS: Record<string, ElName> = { empty: 'ground', sand: 'ground', soil: 'ground' }

/** Validate one rule. The self cell is forced to be life: a mind only rewrites its own body. */
export function validateRule(raw: unknown): Rule | string {
  if (!raw || typeof raw !== 'object') return 'rule is not an object'
  const r = raw as Record<string, unknown>
  const d = String(r.dir ?? 'any').toLowerCase()
  const dir = (ALIAS[d] ?? d) as Dir
  if (!DIRS.includes(dir)) return `bad dir ${String(r.dir)}`
  const norm = (v: unknown) => (typeof v === 'string' ? ELEMENT_ALIAS[v] ?? v : v)
  const names = { neighbor: norm(r.neighbor), toSelf: norm(r.toSelf ?? 'life'), toNeighbor: norm(r.toNeighbor) }
  for (const [k, v] of Object.entries(names))
    if (!BODY_ELEMENTS.includes(v as ElName)) return `bad ${k} ${String(v)}`
  const chance = Number(r.chance ?? 0.1)
  if (!Number.isFinite(chance)) return 'bad chance'
  if (names.toNeighbor === 'life' && names.neighbor !== 'plant' && names.neighbor !== 'life') return `life grows only onto plants, not ${String(names.neighbor)}`
  return {
    self: 'life',
    dir,
    neighbor: names.neighbor as ElName,
    toSelf: names.toSelf as ElName,
    toNeighbor: names.toNeighbor as ElName,
    chance: Math.min(MAX_CHANCE, Math.max(0, chance)),
  }
}

/** Keep the first SELF_WORDS words of a self-portrait. */
export function clipSelf(v: unknown): string {
  const t = clip(v, 400)
  if (!t) return ''
  const ws = t.split(' ')
  return ws.length > SELF_WORDS ? ws.slice(0, SELF_WORDS).join(' ') + '…' : t
}

/** Extract the first JSON object from a model reply (fences, prose around it) and bound it. */
export function parseMindReply(text: string): { reply: MindReply | null; errors: string[] } {
  const errors: string[] = []
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { reply: null, errors: ['no JSON object'] }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text.slice(start, end + 1))
  } catch (e) {
    return { reply: null, errors: ['invalid JSON: ' + (e as Error).message] }
  }
  const rules: Rule[] = []
  for (const raw of Array.isArray(data.rules) ? data.rules : []) {
    const r = validateRule(raw)
    if (typeof r === 'string') errors.push(r)
    else if (rules.length < MAX_RULES) rules.push(r)
  }
  const reply: MindReply = { thought: clip(data.thought, 160), say: clip(data.say, 90), remember: clip(data.remember, 110), rules, self: clipSelf(data.self) }
  if ('move' in data) {
    const m = typeof data.move === 'string' ? (ALIAS[data.move.toLowerCase()] ?? data.move.toLowerCase()) : null
    reply.move = HEADINGS.includes(m as Heading) ? (m as Heading) : null
  }
  if (data.fusion === 'accept' || data.fusion === 'refuse') reply.fusion = data.fusion
  const g = data.give as Record<string, unknown> | null | undefined
  if (g && typeof g === 'object') {
    const to = Number(String(g.to ?? '').replace('#', '')), amount = Number(g.amount)
    if (Number.isInteger(to) && amount > 0) reply.give = { to, amount }
  }
  return { reply, errors }
}

export const ruleSignature = (r: Rule): string => `${r.self}+${r.neighbor}@${r.dir}->${r.toSelf}+${r.toNeighbor}`

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-zÀ-ɏ']{3,}/g) ?? []).map((w) => w.replace(/'/g, ''))
}

export const INITIAL_VOCAB = new Set([...words(SYSTEM_PROMPT), ...EL_NAMES, ...words(
  'the and you your are with for not but have this that from what who how why when where can will just all more one two',
), ...['food', 'kin', 'water', 'ground', 'void', 'hungry', 'gift'], // the demo minds' concepts are given too
...Object.values(TRAIT_WORDS).flat().flatMap(words)]) // and so is their nature: "frugal" was counted 65 times (garden season 7)

/** Real English too rare for both frequency lists, said by the minds in the garden (seasons 6-7). */
const RARE_ENGLISH = new Set(['abound', 'beckon', 'awoken', 'sib', 'sibs'])
const known = (w: string) => w.length >= 3 && (COMMON_ENGLISH.has(w) || INITIAL_VOCAB.has(w) || RARE_ENGLISH.has(w))
const ENDINGS = ['s', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'ers', 'est', 'ness', 'ful', 'less', 'ment', 'ish', 'ward', 'wards']
/** The words a known word could come from once an ending is taken off: glow-ing, glid(e)-ing,
 *  shimm-er → (none), sunn(y)-est → sunny, hopp-ing → hop, happi-ly → happy. */
function stems(w: string): string[] {
  const out: string[] = []
  for (const suf of ENDINGS) {
    if (!w.endsWith(suf) || w.length - suf.length < 2) continue
    const s = w.slice(0, -suf.length)
    out.push(s, s + 'e')
    if (s.endsWith('i')) out.push(s.slice(0, -1) + 'y')
    if (s.length >= 3 && s.at(-1) === s.at(-2)) out.push(s.slice(0, -1))
  }
  return out
}

/** A word nobody gave the minds: absent from their prompt and from everyday English, even with a
 *  usual ending or two (plants, walked, eating, abundantly, flickering). "south", "share" or
 *  "abundant" are not inventions. */
export function isInvented(w: string): boolean {
  if (w.length < 3 || known(w)) return false // "i'm" loses its apostrophe and becomes "im"
  for (const s of stems(w)) if (known(s) || stems(s).some(known)) return false
  return true
}

export interface Conventions {
  words: Array<{ word: string; minds: number }>
  rules: Array<{ sig: string; minds: number }>
  total: number
}

/**
 * A convention is something at least two minds share that nobody gave them: an invented word
 * (see isInvented), or a rule absent from the default physics.
 */
export function conventions(orgs: Iterable<Organism>, defaultRules: Rule[]): Conventions {
  const byWord = new Map<string, Set<number>>()
  const byRule = new Map<string, Set<number>>()
  const given = new Set(defaultRules.map(ruleSignature))
  for (const o of orgs) {
    for (const w of new Set(o.lexicon)) if (isInvented(w)) byWord.set(w, (byWord.get(w) ?? new Set()).add(o.id))
    for (const r of o.rules) {
      const s = ruleSignature(r)
      if (!given.has(s)) byRule.set(s, (byRule.get(s) ?? new Set()).add(o.id))
    }
  }
  const shared = <T extends string>(m: Map<string, Set<number>>, key: T) =>
    [...m].filter(([, s]) => s.size >= 2).map(([k, s]) => ({ [key]: k, minds: s.size }) as { minds: number } & Record<T, string>).sort((a, b) => b.minds - a.minds)
  const ws = shared(byWord, 'word')
  const rs = shared(byRule, 'sig')
  return { words: ws, rules: rs, total: ws.length + rs.length }
}

// ---------------------------------------------------------------- demo minds (no key, no tokens)

const SYLLABLES = ['ka', 'lu', 'mi', 'to', 'sen', 'pa', 'ri', 'nu', 'ze', 'ol', 'ta', 'vi', 'mo', 'ke']

function inventWord(rng: () => number): string {
  let w = ''
  do {
    w = ''
    const n = 2 + Math.floor(rng() * 2)
    for (let i = 0; i < n; i++) w += SYLLABLES[Math.floor(rng() * SYLLABLES.length)]
  } while (!isInvented(w))
  return w
}

/** Words this mind knows: learned from memory lines of the form `word "x" means y`. */
export function knownWords(org: Organism): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of org.memory) {
    const hit = line.match(/word "([a-z]+)" means (\w+)/)
    if (hit) m.set(hit[2], hit[1])
  }
  return m
}

/** Where most of the plants in view are, as a heading (null when none). */
function towardPlants(view: string): Heading | null {
  const rows = view.split('\n').map((r) => r.slice(1, -1))
  const c = (rows.length - 1) / 2
  let sx = 0, sy = 0, n = 0
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '*' && ((sx += x - c), (sy += y - c), n++)))
  if (!n) return null
  return Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'east' : 'west') : sy > 0 ? 'south' : 'north'
}

const pick = <T,>(xs: T[], rng: () => number): T => xs[Math.floor(rng() * xs.length)]

/** A self-portrait assembled from nature and lived events (demo minds only). */
export function demoSelf(org: Organism, colony: Colony | null): string {
  const t = org.temperament
  const top = [...TRAITS].sort((a, b) => t[b] - t[a])[0]
  const kind = { curiosity: 'wanderer', greed: 'grazer', sociability: 'companion', caution: 'watcher' }[top]
  const root = colony ? lineage(colony, org.id).slice(-1)[0] : org.id
  const last = org.diary[org.diary.length - 1]?.replace(/^t\d+: /, '') ?? 'I just woke up'
  const mood = org.energy <= 0 ? 'dying' : org.hungry ? 'hungry' : 'fed'
  return clipSelf(`I am a ${mood} ${kind} of the line of #${root}, generation ${org.gen}; lately ${last.replace(/^I /, 'I ')}.`)
}

/**
 * A heuristic stand-in for an LLM, so the page lives on its own. Its temperament decides: greedy
 * minds walk to plants and eat, curious ones wander, cautious ones refuse fusion, sociable ones
 * talk and give energy to hungry neighbours. It names what it sees with invented words and adopts
 * the words it hears; memory and nature are inherited on division, so both drift down lineages.
 */
export function demoMind(world: World, org: Organism, rng: () => number, colony: Colony | null = null, neighbors: Organism[] = []): MindReply {
  const t = org.temperament
  const view = asciiView(world, org, 6)
  const tally = { plant: 0, water: 0, other: 0 }
  for (const ch of view) {
    if (ch === '*') tally.plant++
    else if (ch === '~') tally.water++
    else if (ch === 'x') tally.other++
  }
  const concept = org.hungry ? 'hungry' : tally.plant > 3 ? 'food' : tally.other > 3 ? 'kin' : tally.water > 6 ? 'water' : 'void'
  const lexicon = knownWords(org)
  let remember = ''
  // Hearing a neighbour name something: adopt its word, more readily when sociable.
  for (const m of org.inbox.slice(-3)) {
    const [word, meaning] = m.text.split(' ')
    if (word && meaning && /^[a-z]+$/.test(word) && lexicon.get(meaning) !== word && rng() < 0.3 + 0.5 * t.sociability) {
      lexicon.set(meaning, word)
      remember = `word "${word}" means ${meaning}`
      break
    }
  }
  if (!lexicon.has(concept)) {
    const w = inventWord(rng)
    lexicon.set(concept, w)
    remember = `word "${w}" means ${concept}`
  }
  const rules: Rule[] = []
  if (tally.plant > 0) rules.push({ self: 'life', dir: 'any', neighbor: 'plant', toSelf: 'life', toNeighbor: t.greed > 0.5 ? 'life' : 'ground', chance: 0.1 + 0.3 * t.greed })
  if (tally.water > 2 && t.curiosity > 0.5) rules.push({ self: 'life', dir: 'any', neighbor: 'grass', toSelf: 'life', toNeighbor: 'plant', chance: 0.05 })
  const food = towardPlants(view)
  let move: Heading | null = null
  let why: string
  if (food && (org.hungry || t.greed > 0.4)) (move = food), (why = `Plants to the ${food}. I go and eat.`)
  else if (t.curiosity > 0.5 || org.hungry) (move = rng() < 0.6 && org.heading ? org.heading : pick(HEADINGS, rng)), (why = `Nothing to eat here. I walk ${move} to see.`)
  else why = 'I stay where I am and wait.'
  const hungryNear = neighbors.find((n) => n.hungry && n.alive)
  let give: MindReply['give'] = null
  if (hungryNear && !org.hungry && t.sociability > 0.5 && org.energy > org.size) {
    give = { to: hungryNear.id, amount: Math.round(org.energy * 0.2) }
    why = `#${hungryNear.id} is hungry. I give it some of mine.`
  }
  const fusion: 'accept' | 'refuse' = t.caution > 0.6 && t.sociability < 0.5 ? 'refuse' : tally.other > 3 && t.caution > 0.5 ? 'refuse' : 'accept'
  const word = lexicon.get(concept)!
  const speaks = rng() < 0.3 + 0.7 * t.sociability || org.hungry
  return {
    thought: org.whisper ? `A voice said "${org.whisper.slice(0, 40)}". ${why}` : why,
    say: speaks ? `${word} ${concept}` : '',
    remember,
    rules: rules.slice(0, MAX_RULES),
    self: demoSelf(org, colony),
    move,
    fusion,
    give,
  }
}

// ---------------------------------------------------------------- real minds (OpenAI-compatible)

export interface LlmConfig {
  endpoint: string
  model: string
  apiKey: string
}

/** When the endpoint says it is busy (429/503) without a Retry-After, minds wait this long. */
export const BUSY_MS = 15000

export interface Busy {
  ms: number
  reason: string
}

export async function llmMind(cfg: LlmConfig, messages: Array<{ role: string; content: string }>, signal?: AbortSignal): Promise<{ reply: MindReply | null; errors: string[]; busy?: Busy }> {
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.9, max_tokens: 500 }),
    signal,
  })
  // 429 / 503 mean "slow down", not "broken": the minds wait instead of reporting an error.
  if (res.status === 429 || res.status === 503) {
    const text = await res.text()
    let reason = 'the endpoint is busy'
    try {
      const e = JSON.parse(text)?.error
      reason = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : reason
    } catch {}
    const after = Number(res.headers.get('retry-after'))
    return { reply: null, errors: [], busy: { ms: after > 0 ? after * 1000 : BUSY_MS, reason: reason.slice(0, 120) } }
  }
  if (!res.ok) return { reply: null, errors: [`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`] }
  const data = await res.json()
  const text: string = data?.choices?.[0]?.message?.content ?? ''
  return parseMindReply(text)
}

/** Apply a reply to the organism itself: rules, stance, walk, self-portrait, notes and words.
 *  Giving energy involves another body, so the simulation settles it (see sim.ts). */
export function applyReply(org: Organism, reply: MindReply): void {
  org.thought = reply.thought
  org.say = reply.say
  if (reply.rules.length) org.rules = reply.rules
  if (reply.self) org.self = reply.self
  if (reply.move !== undefined) org.heading = reply.move
  if (reply.fusion) org.fusion = reply.fusion
  if (reply.remember) org.memory = dedupe([...org.memory, reply.remember]).slice(-6)
  org.lexicon = [...new Set([...org.lexicon, ...words(reply.say)])].slice(-60)
}

// A mind sees only its neighbourhood, hears only adjacent minds, and acts only by emitting rules
// for its own body. Everything it returns is parsed, validated and bounded before it touches the grid.

import { DIRS, EL_NAMES, EMPTY, LIFE, PLANT, SAND, WALL, WATER, type Dir, type ElName, type Rule, type World } from './world.ts'
import type { Organism } from './organisms.ts'

export const MAX_RULES = 4
export const MAX_CHANCE = 0.5
const BODY_ELEMENTS: ElName[] = ['empty', 'sand', 'water', 'plant', 'life']

export const SYSTEM_PROMPT = `You are a mind that emerged from a colony of cells in a 2D world.
No single cell of yours thinks; together, you do. You see only your surroundings as an ASCII map:
'o' is your own body, 'x' another organism, '.' sand, '~' water, '*' plant, '#' wall, ' ' empty.
You cannot move or speak to the world directly. You act ONLY by writing up to 4 rules for your own
body cells. A rule rewrites a pair: one of your life cells ("self", always "life") and one neighbour
cell in direction dir (up, down, left, right, side, diag, any). If the neighbour is "neighbor",
the pair becomes toSelf + toNeighbor with probability chance (max 0.5).
Elements: empty, sand, water, plant, life. Eating a plant: neighbor plant -> toNeighbor life.
You may also say one short line to the minds touching you, and keep one short memory.
Reply with JSON only:
{"thought":"<=20 words","say":"<=12 words","remember":"<=15 words","rules":[{"self":"life","dir":"any","neighbor":"plant","toSelf":"life","toNeighbor":"life","chance":0.2}]}`

const GLYPH: Record<number, string> = { [EMPTY]: ' ', [WALL]: '#', [SAND]: '.', [WATER]: '~', [PLANT]: '*' }

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

export function buildMessages(world: World, org: Organism, neighbors: Organism[]): Array<{ role: string; content: string }> {
  const heard = org.inbox.slice(-4).map((m) => `#${m.from}: "${m.text}"`).join('\n') || '(silence)'
  const user = [
    `You are #${org.id}, generation ${org.gen}, ${org.size} cells. Time ${world.tick}.`,
    `Your memory:\n${org.memory.map((m) => '- ' + m).join('\n') || '(empty)'}`,
    `Your current rules: ${JSON.stringify(org.rules)}`,
    `Minds touching you: ${neighbors.map((n) => '#' + n.id).join(', ') || 'none'}`,
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
}

const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')

/** Validate one rule. The self cell is forced to be life: a mind only rewrites its own body. */
export function validateRule(raw: unknown): Rule | string {
  if (!raw || typeof raw !== 'object') return 'rule is not an object'
  const r = raw as Record<string, unknown>
  const dir = (r.dir ?? 'any') as Dir
  if (!DIRS.includes(dir)) return `bad dir ${String(r.dir)}`
  const names = { neighbor: r.neighbor, toSelf: r.toSelf ?? 'life', toNeighbor: r.toNeighbor }
  for (const [k, v] of Object.entries(names))
    if (!BODY_ELEMENTS.includes(v as ElName)) return `bad ${k} ${String(v)}`
  const chance = Number(r.chance ?? 0.1)
  if (!Number.isFinite(chance)) return 'bad chance'
  return {
    self: 'life',
    dir,
    neighbor: names.neighbor as ElName,
    toSelf: names.toSelf as ElName,
    toNeighbor: names.toNeighbor as ElName,
    chance: Math.min(MAX_CHANCE, Math.max(0, chance)),
  }
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
  return {
    reply: { thought: clip(data.thought, 160), say: clip(data.say, 90), remember: clip(data.remember, 110), rules },
    errors,
  }
}

export const ruleSignature = (r: Rule): string => `${r.self}+${r.neighbor}@${r.dir}->${r.toSelf}+${r.toNeighbor}`

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-zÀ-ɏ']{3,}/g) ?? []).map((w) => w.replace(/'/g, ''))
}

export const INITIAL_VOCAB = new Set([...words(SYSTEM_PROMPT), ...EL_NAMES, ...words(
  'the and you your are with for not but have this that from what who how why when where can will just all more one two',
), ...['food', 'kin', 'rain', 'ground', 'void']]) // the demo minds' concepts are given too

export interface Conventions {
  words: Array<{ word: string; minds: number }>
  rules: Array<{ sig: string; minds: number }>
  total: number
}

/**
 * A convention is something at least two minds share that nobody gave them: a word absent from the
 * prompt they were all born with, or a rule absent from the default physics.
 */
export function conventions(orgs: Iterable<Organism>, defaultRules: Rule[]): Conventions {
  const byWord = new Map<string, Set<number>>()
  const byRule = new Map<string, Set<number>>()
  const given = new Set(defaultRules.map(ruleSignature))
  for (const o of orgs) {
    for (const w of new Set(o.lexicon)) if (!INITIAL_VOCAB.has(w)) byWord.set(w, (byWord.get(w) ?? new Set()).add(o.id))
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
  const n = 2 + Math.floor(rng() * 2)
  let w = ''
  for (let i = 0; i < n; i++) w += SYLLABLES[Math.floor(rng() * SYLLABLES.length)]
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

/**
 * A heuristic stand-in for an LLM, so the page lives on its own. It names what it sees with
 * invented words, adopts words it hears from neighbours, and writes rules from what surrounds it.
 * Memory is inherited on division, so vocabularies spread down lineages and across contact.
 */
export function demoMind(world: World, org: Organism, rng: () => number): MindReply {
  const view = asciiView(world, org, 6)
  const tally = { plant: 0, water: 0, empty: 0, other: 0, sand: 0 }
  for (const ch of view) {
    if (ch === '*') tally.plant++
    else if (ch === '~') tally.water++
    else if (ch === ' ') tally.empty++
    else if (ch === 'x') tally.other++
    else if (ch === '.') tally.sand++
  }
  const concept = tally.plant > 3 ? 'food' : tally.other > 3 ? 'kin' : tally.water > 6 ? 'rain' : tally.sand > 40 ? 'ground' : 'void'
  const lexicon = knownWords(org)
  let remember = ''
  // Hearing a neighbour name the same thing: adopt its word half the time (memes travel by contact).
  for (const m of org.inbox.slice(-3)) {
    const [word, meaning] = m.text.split(' ')
    if (word && meaning && /^[a-z]+$/.test(word) && lexicon.get(meaning) !== word && rng() < 0.5) {
      lexicon.set(meaning, word)
      remember = `word "${word}" means ${meaning}`
      break
    }
  }
  // No word yet for what it sees: coin one (this memory line wins over an adoption this turn).
  if (!lexicon.has(concept)) {
    const w = inventWord(rng)
    lexicon.set(concept, w)
    remember = `word "${w}" means ${concept}`
  }
  const rules: Rule[] = []
  const d = (): Dir => (['up', 'down', 'side', 'any'] as Dir[])[Math.floor(rng() * 4)]
  if (tally.plant > 0) rules.push({ self: 'life', dir: 'any', neighbor: 'plant', toSelf: 'life', toNeighbor: 'life', chance: 0.3 })
  if (tally.water > 2) rules.push({ self: 'life', dir: d(), neighbor: 'water', toSelf: 'life', toNeighbor: 'plant', chance: 0.1 })
  if (tally.other > 3) rules.push({ self: 'life', dir: 'any', neighbor: 'life', toSelf: 'plant', toNeighbor: 'life', chance: 0.02 })
  if (tally.empty > 60 && org.size < 80) rules.push({ self: 'life', dir: d(), neighbor: 'empty', toSelf: 'life', toNeighbor: 'life', chance: 0.05 })
  const word = lexicon.get(concept)!
  const thoughts: Record<string, string> = {
    food: 'Green things near me. My edges should turn them into me.',
    kin: 'Another body presses against mine. I give it a little of myself.',
    rain: 'Water all around. I will plant it.',
    ground: 'Heavy grains below. I stay still and listen.',
    void: 'Nothing around me. I reach out into the empty.',
  }
  return {
    thought: org.whisper ? `A voice said "${org.whisper.slice(0, 40)}". ${thoughts[concept]}` : thoughts[concept],
    say: `${word} ${concept}`,
    remember,
    rules: rules.slice(0, MAX_RULES),
  }
}

// ---------------------------------------------------------------- real minds (OpenAI-compatible)

export interface LlmConfig {
  endpoint: string
  model: string
  apiKey: string
}

export async function llmMind(cfg: LlmConfig, messages: Array<{ role: string; content: string }>, signal?: AbortSignal): Promise<{ reply: MindReply | null; errors: string[] }> {
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.9, max_tokens: 400 }),
    signal,
  })
  if (!res.ok) return { reply: null, errors: [`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`] }
  const data = await res.json()
  const text: string = data?.choices?.[0]?.message?.content ?? ''
  return parseMindReply(text)
}

/** Apply a reply to the organism: rules replace its body physics, memory and speech accumulate. */
export function applyReply(org: Organism, reply: MindReply): void {
  org.thought = reply.thought
  org.say = reply.say
  if (reply.rules.length) org.rules = reply.rules
  if (reply.remember) org.memory = [...org.memory, reply.remember].slice(-8)
  org.lexicon = [...new Set([...org.lexicon, ...words(reply.say)])].slice(-60)
}

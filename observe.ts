import { writeFileSync } from 'node:fs'
import { createSim, frame, think } from './src/engine/sim.ts'
import { PACES } from './src/engine/pace.ts'
import { conventions } from './src/engine/mind.ts'

const BASE = process.argv[2]
const H = { 'cf-access-jwt-assertion': 'job-observe' }
const orig = globalThis.fetch
globalThis.fetch = ((u: string, init: RequestInit = {}) => orig(u, { ...init, headers: { ...(init.headers as object), ...H } })) as typeof fetch
const preset = await (await fetch(BASE + '/preset.json')).json()
const usage0 = await (await fetch(BASE + '/api/usage')).json()
const sim = createSim(Date.now() % 100000)
sim.llm = { endpoint: BASE + '/api/chat', model: preset.model, apiKey: 'server-side' }
const pace = PACES.normal
const t0 = Date.now()
const timeline: Array<{ s: number; alive: number; ever: number; sizes: string }> = []
let acc = 0, last = t0
while (Date.now() - t0 < 180_000) {
  const now = Date.now()
  acc += ((now - last) / 1000) * pace.stepsPerSecond
  last = now
  for (; acc >= 1; acc--) frame(sim)
  think(sim, now - t0, 5000, pace.gapMs)
  const s = Math.floor((now - t0) / 1000)
  if (s % 15 === 0 && timeline[timeline.length - 1]?.s !== s) {
    const alive = [...sim.colony.orgs.values()].filter((o) => o.alive)
    timeline.push({ s, alive: alive.length, ever: sim.colony.orgs.size, sizes: alive.map((o) => `${o.size}/${Math.round(o.energy)}`).join(' ') })
    console.log(JSON.stringify(timeline[timeline.length - 1]))
  }
  await new Promise((r) => setTimeout(r, 50))
}
while (sim.inFlight > 0) await new Promise((r) => setTimeout(r, 200))
const usage1 = await (await fetch(BASE + '/api/usage')).json()
const all = [...sim.colony.orgs.values()]
const out = {
  model: preset.model, thoughts: sim.thoughts, timeline, usage0, usage1, lastError: sim.lastError,
  orgs: all.map((o) => ({ id: o.id, gen: o.gen, fate: o.fate || 'alive', self: o.self, say: o.say, memory: o.memory, diary: o.diary, temperament: o.temperament, heading: o.heading, fusion: o.fusion, lexicon: o.lexicon })),
  feed: sim.colony.feed.events.map((e) => `${e.kind}: ${e.text}`),
  conventions: conventions(all.filter((o) => o.alive), sim.rules),
}
writeFileSync('observe-v1.json', JSON.stringify(out, null, 1))
const n = sim.thoughts.length
console.log('thoughts', n, 'distinct', new Set(sim.thoughts.map((t) => t.text)).size, 'selves', new Set(sim.thoughts.map((t) => t.self)).size)

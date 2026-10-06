import { createSim, frame, think } from './src/engine/sim.ts'
import { activeMinds, drift } from './src/engine/organisms.ts'
import { conventions } from './src/engine/mind.ts'
import { count, PLANT } from './src/engine/world.ts'

const sim = createSim(Number(process.argv[2] ?? 7))
let t = 0
for (let k = 1; k <= 4000; k++) {
  frame(sim)
  think(sim, (t += 143), 5000)
  if (k % 400 === 0) {
    const alive = [...sim.colony.orgs.values()].filter((o) => o.alive)
    console.log(`t${k} alive=${alive.length} ever=${sim.colony.orgs.size} plants=${count(sim.world, PLANT)} sizes=${alive.map((o) => o.size + '/' + Math.round(o.energy)).join(' ')} gen=${Math.max(...[...sim.colony.orgs.values()].map((o) => o.gen))}`)
  }
}
const all = [...sim.colony.orgs.values()]
console.log('fates', Object.entries(all.reduce((m, o) => ((m[o.fate || 'alive'] = (m[o.fate || 'alive'] ?? 0) + 1), m), {} as Record<string, number>)))
console.log('distinct thoughts', new Set(sim.thoughts.map((x) => x.text)).size, '/', sim.thoughts.length)
console.log('conv', conventions(all.filter((o) => o.alive), sim.rules).words.slice(0, 5))
console.log('feed kinds', sim.colony.feed.events.map((e) => e.kind).join(','))
const m = activeMinds(sim.colony)[0]
if (m) console.log(m.self, m.temperament, 'drift', drift(sim.colony, m.id), m.diary)

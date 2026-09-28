import { DIRS, EL_NAMES, LIFE, paint, type Dir, type ElName, type Rule } from './engine/world.ts'
import { activeMinds, lineage, type Organism } from './engine/organisms.ts'
import { conventions, ruleSignature } from './engine/mind.ts'
import { createSim, frame, setRules, think, THOUGHT_GAP_MS, type Sim } from './engine/sim.ts'

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const CELL = 9
const COLORS: Record<ElName, string> = {
  empty: '#0d0f16',
  wall: '#5b6070',
  sand: '#d9bb6c',
  water: '#3b7ddb',
  plant: '#4fae55',
  life: '#e8e8e8',
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('world')
const ctx = canvas.getContext('2d')!

let sim: Sim = createSim(Date.now() % 100000)
let paused = false
let brush: ElName | 'select' = 'select'
let selected: number | null = null
let showGraph = true

// ------------------------------------------------------------------ settings (key stays local)

const store = {
  get: (k: string, d = '') => localStorage.getItem('aunt-hillary.' + k) ?? d,
  set: (k: string, v: string) => localStorage.setItem('aunt-hillary.' + k, v),
}
$<HTMLInputElement>('endpoint').value = store.get('endpoint', DEFAULT_ENDPOINT)
$<HTMLInputElement>('model').value = store.get('model')
$<HTMLInputElement>('apikey').value = store.get('key')

function applyMode(mode: string): void {
  const endpoint = $<HTMLInputElement>('endpoint').value.trim()
  const model = $<HTMLInputElement>('model').value.trim()
  const apiKey = $<HTMLInputElement>('apikey').value.trim()
  store.set('endpoint', endpoint)
  store.set('model', model)
  store.set('key', apiKey)
  const ok = mode === 'llm' && endpoint && model && apiKey
  sim.llm = ok ? { endpoint, model, apiKey } : null
  store.set('mode', ok ? 'llm' : 'demo')
  $('mode').textContent = ok ? `LLM (${model})` : 'demo (no key)'
  $('llmerr').textContent = mode === 'llm' && !ok ? 'Endpoint, model and key are all needed.' : ''
}
$('useLlm').onclick = () => applyMode('llm')
$('useDemo').onclick = () => applyMode('demo')
applyMode(store.get('mode', 'demo'))

// A self-hosted deployment may ship `preset.json` next to index.html ({ endpoint, model, apiKey,
// note? }), typically pointing at a same-origin proxy that holds the real key. The public build
// has none: the fetch 404s and nothing changes.
fetch('./preset.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then((p: { endpoint?: string; model?: string; apiKey?: string; note?: string } | null) => {
    if (!p?.endpoint) return
    $<HTMLInputElement>('endpoint').value = p.endpoint
    $<HTMLInputElement>('apikey').value = p.apiKey ?? 'server-side'
    if (!store.get('model') && p.model) $<HTMLInputElement>('model').value = p.model
    applyMode('llm')
    if (p.note) $('llmerr').textContent = p.note
  })
  .catch(() => {})

// ------------------------------------------------------------------ toolbar

const brushes = $('brushes')
for (const b of ['select', ...EL_NAMES] as const) {
  const btn = document.createElement('button')
  btn.textContent = b
  btn.dataset.brush = b
  btn.style.setProperty('--sw', b === 'select' ? '#fff' : COLORS[b])
  btn.onclick = () => {
    brush = b
    brushes.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === btn))
  }
  if (b === 'select') btn.classList.add('on')
  brushes.append(btn)
}
$('pause').onclick = () => {
  paused = !paused
  $('pause').textContent = paused ? 'Play' : 'Pause'
}
$<HTMLInputElement>('rain').onchange = (e) => (sim.world.rain = (e.target as HTMLInputElement).checked ? 0.004 : 0)
$<HTMLInputElement>('graph').onchange = (e) => (showGraph = (e.target as HTMLInputElement).checked)
$('reset').onclick = () => {
  const llm = sim.llm
  sim = createSim(Date.now() % 100000)
  sim.llm = llm
  selected = null
  renderRuleList()
}

// ------------------------------------------------------------------ painting and selecting

let drawing = false
function cellAt(e: MouseEvent): [number, number] {
  const r = canvas.getBoundingClientRect()
  return [Math.floor(((e.clientX - r.left) / r.width) * sim.world.w), Math.floor(((e.clientY - r.top) / r.height) * sim.world.h)]
}
canvas.onmousedown = (e) => {
  const [x, y] = cellAt(e)
  if (brush === 'select') {
    const id = sim.world.owner[y * sim.world.w + x]
    selected = id >= 0 ? id : nearestOrganism(x, y)
    return
  }
  drawing = true
  paint(sim.world, x, y, 1, EL_NAMES.indexOf(brush))
}
canvas.onmousemove = (e) => {
  if (!drawing || brush === 'select') return
  const [x, y] = cellAt(e)
  paint(sim.world, x, y, 1, EL_NAMES.indexOf(brush))
}
window.onmouseup = () => (drawing = false)

function nearestOrganism(x: number, y: number): number | null {
  let best: Organism | null = null, bd = 64
  for (const o of sim.colony.orgs.values()) {
    if (!o.alive) continue
    const d = (o.cx - x) ** 2 + (o.cy - y) ** 2
    if (d < bd) (bd = d), (best = o)
  }
  return best?.id ?? null
}

// ------------------------------------------------------------------ rule editor (before → after)

const draft: Rule = { self: 'sand', dir: 'down', neighbor: 'water', toSelf: 'plant', toNeighbor: 'plant', chance: 0.2 }
const cycle = (e: ElName): ElName => EL_NAMES[(EL_NAMES.indexOf(e) + 1) % EL_NAMES.length]
function cellButton(key: 'self' | 'neighbor' | 'toSelf' | 'toNeighbor'): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'cell'
  b.title = key
  b.style.background = COLORS[draft[key]]
  b.textContent = draft[key]
  b.onclick = () => {
    draft[key] = cycle(draft[key])
    renderEditor()
  }
  return b
}
const dirSel = $<HTMLSelectElement>('dir')
for (const d of DIRS) dirSel.append(new Option(d, d))
dirSel.onchange = () => {
  draft.dir = dirSel.value as Dir
  renderEditor()
}
$<HTMLInputElement>('chance').oninput = (e) => (draft.chance = Number((e.target as HTMLInputElement).value))
function renderEditor(): void {
  $('before').replaceChildren(cellButton('self'), cellButton('neighbor'))
  $('after').replaceChildren(cellButton('toSelf'), cellButton('toNeighbor'))
  dirSel.value = draft.dir
  $('dirlabel').textContent = `→`
  $('before').dataset.dir = draft.dir
}
$('addGlobal').onclick = () => {
  setRules(sim, [{ ...draft }, ...sim.rules])
  renderRuleList()
}
$('addOrg').onclick = () => {
  const o = selected != null ? sim.colony.orgs.get(selected) : undefined
  if (!o?.alive) return alert('Select an organism first (brush: select, then click a body).')
  o.rules = [{ ...draft, self: 'life' }, ...o.rules].slice(0, 4)
}
function renderRuleList(): void {
  const ol = $('rulelist')
  ol.replaceChildren(
    ...sim.rules.map((r, k) => {
      const li = document.createElement('li')
      li.textContent = `${ruleText(r)} `
      const x = document.createElement('button')
      x.textContent = '×'
      x.onclick = () => {
        setRules(sim, sim.rules.filter((_, j) => j !== k))
        renderRuleList()
      }
      li.append(x)
      return li
    }),
  )
}
const ruleText = (r: Rule) => `${r.self}|${r.neighbor} (${r.dir}) → ${r.toSelf}|${r.toNeighbor} ${Math.round(r.chance * 100)}%`
renderEditor()
renderRuleList()

// ------------------------------------------------------------------ rendering

function draw(): void {
  const { w, h, cells, owner } = sim.world
  for (let i = 0; i < w * h; i++) {
    const c = cells[i]
    const o = c === LIFE && owner[i] >= 0 ? sim.colony.orgs.get(owner[i]) : undefined
    ctx.fillStyle = o ? `hsl(${o.hue} 75% ${o.id === selected ? 72 : 58}%)` : COLORS[EL_NAMES[c]]
    ctx.fillRect((i % w) * CELL, Math.floor(i / w) * CELL, CELL, CELL)
  }
  if (!showGraph) return
  const minds = new Set(activeMinds(sim.colony).map((o) => o.id))
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.setLineDash([5, 4])
  for (const [a, b] of sim.edges) {
    const A = sim.colony.orgs.get(a)!, B = sim.colony.orgs.get(b)!
    ctx.beginPath()
    ctx.moveTo((A.cx + 0.5) * CELL, (A.cy + 0.5) * CELL)
    ctx.lineTo((B.cx + 0.5) * CELL, (B.cy + 0.5) * CELL)
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.font = '11px ui-monospace, monospace'
  for (const o of sim.colony.orgs.values()) {
    if (!o.alive) continue
    const x = (o.cx + 0.5) * CELL, y = (o.cy + 0.5) * CELL
    const r = minds.has(o.id) ? 11 : 7
    ctx.beginPath()
    ctx.arc(x, y, r + (o.thinking ? 3 * Math.sin(performance.now() / 120) : 0), 0, Math.PI * 2)
    ctx.fillStyle = minds.has(o.id) ? 'rgba(10,12,20,0.85)' : 'rgba(10,12,20,0.5)'
    ctx.fill()
    ctx.strokeStyle = o.id === selected ? '#fff' : `hsl(${o.hue} 80% 70%)`
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.fillText(minds.has(o.id) ? `#${o.id}` : '·', x, y + 4)
    if (o.say && minds.has(o.id)) {
      const t = `“${o.say.slice(0, 28)}”`
      const tw = ctx.measureText(t).width + 8
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.fillRect(x - tw / 2, y - r - 20, tw, 15)
      ctx.fillStyle = '#111'
      ctx.fillText(t, x, y - r - 9)
    }
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function renderPanel(): void {
  const all = [...sim.colony.orgs.values()]
  const alive = all.filter((o) => o.alive)
  const maxGen = Math.max(0, ...all.map((o) => o.gen))
  $('stats').innerHTML = `<b>${alive.length}</b> organisms · <b>${activeMinds(sim.colony).length}</b> minds (max 8) · <b>${all.length}</b> ever lived · generation <b>${maxGen}</b> · tick ${sim.world.tick}` +
    (sim.llm ? `<div class="note">LLM minds take turns: one thought every ${THOUGHT_GAP_MS / 1000} s at most.</div>` : '') +
    (sim.status ? `<div class="note">${esc(sim.status)}</div>` : '') +
    (sim.lastError ? `<div class="err">${esc(sim.lastError)}</div>` : '')
  const conv = conventions(alive, sim.rules)
  $('conventions').innerHTML = `<div class="big">${conv.total}</div>` +
    conv.words.slice(0, 8).map((w) => `<span class="chip">${esc(w.word)} <small>×${w.minds}</small></span>`).join('') +
    conv.rules.slice(0, 4).map((r) => `<span class="chip rule">${esc(r.sig)} <small>×${r.minds}</small></span>`).join('')
  $('thoughts').innerHTML = sim.thoughts.slice(-12).reverse().map((t) => {
    const o = sim.colony.orgs.get(t.id)
    return `<li><b style="color:hsl(${o?.hue ?? 0} 80% 70%)">#${t.id}</b> ${esc(t.text)}</li>`
  }).join('')
  $('events').innerHTML = sim.colony.events.slice(-8).reverse().map((e) => `<li>${esc(e)}</li>`).join('')
  const o = selected != null ? sim.colony.orgs.get(selected) : undefined
  const box = $('selected')
  if (!o) {
    box.innerHTML = '<p class="hint">Pick the <b>select</b> brush and click a body to read its mind, see its lineage and whisper to it.</p>'
    return
  }
  if (box.dataset.id !== String(o.id) || box.dataset.alive !== String(o.alive)) {
    box.dataset.id = String(o.id)
    box.dataset.alive = String(o.alive)
    box.innerHTML = `<h2>#${o.id}</h2><div id="selbody"></div>` +
      (o.alive ? `<div class="row"><input id="whisper" placeholder="Whisper to #${o.id}…" /><button id="send">Whisper</button></div>` : '')
    const send = document.getElementById('send')
    if (send) send.onclick = () => {
      const inp = $<HTMLInputElement>('whisper')
      o.whisper = inp.value.slice(0, 200)
      o.nextThink = 1 // think at the next opportunity
      inp.value = ''
    }
  }
  $('selbody').innerHTML = `<p>${o.alive ? `${o.size} cells, generation ${o.gen}` : `gone: ${esc(o.fate)}`}` +
    `${o.thinking ? ' · <i>thinking…</i>' : ''}${o.whisper ? ' · whisper pending' : ''}</p>` +
    `<p class="thought">${esc(o.thought || '(no thought yet)')}</p>` +
    `<p><small>says</small> “${esc(o.say)}”</p>` +
    `<p><small>lineage</small> ${lineage(sim.colony, o.id).map((id) => '#' + id).join(' ← ')}</p>` +
    `<p><small>memory</small></p><ul>${o.memory.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` +
    `<p><small>body rules</small></p><ul>${o.rules.map((r) => `<li>${esc(ruleText(r))}</li>`).join('') || '<li>(default physics only)</li>'}</ul>` +
    `<p><small>heard</small></p><ul>${o.inbox.slice(-3).map((m) => `<li>#${m.from}: ${esc(m.text)}</li>`).join('') || '<li>(silence)</li>'}</ul>`
}

// Paid minds sleep when nobody is watching: no input for IDLE_MS and they stop calling the
// endpoint (physics goes on). Any touch, key or mouse move wakes them.
const IDLE_MS = 3 * 60_000
let lastInput = performance.now()
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
  addEventListener(ev, () => {
    lastInput = performance.now()
    sim.idle = false
  }, { passive: true })
}

let lastPanel = 0
function loop(now: number): void {
  sim.idle = now - lastInput > IDLE_MS
  if (!paused) {
    frame(sim)
    think(sim, now)
  }
  draw()
  if (now - lastPanel > 250) {
    renderPanel()
    lastPanel = now
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)

// ?warm=N fast-forwards N frames (a mind thinks every 20 of them); ?autoselect then picks the
// biggest mind. Both exist for screenshots and for impatient visitors.
const params = new URLSearchParams(location.search)
const warm = Math.min(5000, Number(params.get('warm') ?? 0))
if (warm > 0 && !sim.llm) {
  for (let k = 0; k < warm; k++) {
    frame(sim)
    think(sim, (k + 1) * 250, 5000)
  }
  // Hand the minds back to the real clock.
  for (const o of sim.colony.orgs.values()) o.nextThink = 0
}
if (params.has('autoselect')) selected = activeMinds(sim.colony)[0]?.id ?? null
renderPanel()
draw()

// For headless screenshots and curious consoles.
Object.assign(window, { hillary: { get sim() { return sim }, ruleSignature, select: (id: number) => (selected = id) } })

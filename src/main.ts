import { DEFAULT_RAIN, DIRS, EL_NAMES, LIFE, paint, type Dir, type ElName, type Rule } from './engine/world.ts'
import { MAX_ENERGY_PER_CELL, TRAITS, activeMinds, drift, heirOf, lineage, type Organism } from './engine/organisms.ts'
import { conventions, ruleSignature } from './engine/mind.ts'
import { createSim, frame, setRules, think, BUBBLE_MS, THINK_MS, type Sim } from './engine/sim.ts'
import { PACES, SPEEDS, parseSpeed, stepsDue, type Speed } from './engine/pace.ts'
import type { FeedKind } from './engine/feed.ts'

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const CELL = 9
const COLORS: Record<ElName, string> = {
  ground: '#6b5a44',
  rock: '#4a4d57',
  grass: '#2c4a2a',
  water: '#3b7ddb',
  plant: '#7fd86a',
  life: '#e8e8e8',
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('world')
const ctx = canvas.getContext('2d')!

let sim: Sim = createSim(Date.now() % 100000)
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
// Speed: Slow by default, remembered per browser.
let speed: Speed = parseSpeed(store.get('speed'))
const speedBox = $('speed')
for (const sp of SPEEDS) {
  const btn = document.createElement('button')
  btn.textContent = sp[0].toUpperCase() + sp.slice(1)
  btn.dataset.speed = sp
  btn.onclick = () => setSpeed(sp)
  speedBox.append(btn)
}
function setSpeed(sp: Speed): void {
  speed = sp
  store.set('speed', sp)
  speedBox.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.speed === sp))
}
setSpeed(speed)

// The legend is open on a first visit; after that it remembers whether you closed it.
const legend = $<HTMLDetailsElement>('legend')
legend.open = store.get('legend', 'open') === 'open'
legend.ontoggle = () => store.set('legend', legend.open ? 'open' : 'closed')
$<HTMLInputElement>('rain').onchange = (e) => (sim.world.rain = (e.target as HTMLInputElement).checked ? DEFAULT_RAIN : 0)
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

const draft: Rule = { self: 'water', dir: 'any', neighbor: 'ground', toSelf: 'water', toNeighbor: 'plant', chance: 0.02 }
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
  }
  const now = performance.now()
  for (const o of sim.colony.orgs.values()) if (o.alive && o.thinking) outline(o, now)
  for (const o of sim.colony.orgs.values()) if (o.alive && o.bubble && now < o.bubbleUntil) bubble(o, now)
}

/** A pulsing contour around the body whose mind is being asked right now. */
function outline(o: Organism, now: number): void {
  const { w, h, owner } = sim.world
  const pulse = 0.55 + 0.45 * Math.sin(now / 180)
  ctx.beginPath()
  for (let i = 0; i < w * h; i++) {
    if (owner[i] !== o.id) continue
    const x = (i % w) * CELL, y = Math.floor(i / w) * CELL
    const cx = i % w, cy = Math.floor(i / w)
    if (cy === 0 || owner[i - w] !== o.id) ctx.moveTo(x, y), ctx.lineTo(x + CELL, y)
    if (cy === h - 1 || owner[i + w] !== o.id) ctx.moveTo(x, y + CELL), ctx.lineTo(x + CELL, y + CELL)
    if (cx === 0 || owner[i - 1] !== o.id) ctx.moveTo(x, y), ctx.lineTo(x, y + CELL)
    if (cx === w - 1 || owner[i + 1] !== o.id) ctx.moveTo(x + CELL, y), ctx.lineTo(x + CELL, y + CELL)
  }
  ctx.lineWidth = 2 + pulse * 2
  ctx.strokeStyle = `rgba(255, 236, 140, ${0.35 + 0.65 * pulse})`
  ctx.stroke()
  ctx.font = 'bold 12px system-ui, sans-serif'
  const label = `#${o.id} is thinking…`
  const lw = ctx.measureText(label).width + 12
  const lx = clampX((o.cx + 0.5) * CELL, lw / 2), ly = Math.max(4, (o.cy + 0.5) * CELL - 36)
  ctx.fillStyle = 'rgba(10, 12, 20, 0.85)'
  ctx.beginPath()
  ctx.roundRect(lx - lw / 2, ly, lw, 18, 5)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgb(255, 236, 140)'
  ctx.fillText(label, lx, ly + 13)
}

function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of text.split(' ')) {
    if ((cur + ' ' + word).trim().length > max) {
      out.push(cur.trim())
      cur = word
      if (out.length === lines) break
    } else cur += ' ' + word
  }
  if (out.length < lines && cur.trim()) out.push(cur.trim())
  else if (out.length === lines && out.join(' ').length < text.length) out[lines - 1] = out[lines - 1].replace(/\W*$/, '') + '…'
  return out
}
const clampX = (x: number, half: number) => Math.max(half + 2, Math.min(canvas.width - half - 2, x))

/** The thought that just came back, in a bubble next to the body, for a few seconds. */
function bubble(o: Organism, now: number): void {
  const lines = wrap(o.bubble, 34, 3)
  ctx.font = '12px system-ui, sans-serif'
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14
  const th = lines.length * 15 + 20
  const x = clampX((o.cx + 0.5) * CELL, tw / 2)
  const above = (o.cy + 0.5) * CELL - 18 - th
  const y = above > 2 ? above : (o.cy + 0.5) * CELL + 18
  ctx.globalAlpha = Math.min(1, (o.bubbleUntil - now) / 800)
  ctx.fillStyle = 'rgba(250, 250, 245, 0.95)'
  ctx.strokeStyle = `hsl(${o.hue} 80% 55%)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x - tw / 2, y, tw, th, 7)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#15161c'
  ctx.textAlign = 'left'
  lines.forEach((l, k) => ctx.fillText(l, x - tw / 2 + 7, y + 28 + k * 15))
  ctx.fillStyle = `hsl(${o.hue} 70% 35%)`
  ctx.font = 'bold 10px system-ui, sans-serif'
  ctx.fillText(`#${o.id} thought:`, x - tw / 2 + 7, y + 12)
  ctx.globalAlpha = 1
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const FEED_COLORS: Record<FeedKind, string> = {
  born: '#5fd07a', divided: '#4fc3e8', merged: '#f0a24a', dissolved: '#7c8294', rule: '#b48cff', word: '#f2d15c', hunger: '#e86a5f', refused: '#d88bd0', gave: '#7ee0c3', self: '#c9d4ff',
}
let feedShown = -1
let feedSim: Sim | null = null
function renderFeed(): void {
  const feed = sim.colony.feed
  if (feedSim === sim && feedShown === feed.seq) return
  const seen = feedSim === sim ? feedShown : feed.seq
  feedSim = sim
  feedShown = feed.seq
  $('feed').innerHTML = feed.events.slice(-25).reverse().map((e) =>
    `<li data-id="${e.id}" style="--k:${FEED_COLORS[e.kind]}"${e.n > seen ? ' class="fresh"' : ''}>${esc(e.text)}</li>`,
  ).join('') || '<li class="hint">Nothing yet. Life cells need to form a body of 24 or more.</li>'
}
$('feed').onclick = (ev) => {
  const li = (ev.target as HTMLElement).closest('li[data-id]') as HTMLElement | null
  if (!li) return
  const o = sim.colony.orgs.get(Number(li.dataset.id))
  if (o) selected = (heirOf(sim.colony, o) ?? o).id
}

function renderPanel(): void {
  const all = [...sim.colony.orgs.values()]
  const alive = all.filter((o) => o.alive)
  const maxGen = Math.max(0, ...all.map((o) => o.gen))
  $('stats').innerHTML = `<b>${alive.length}</b> organisms · <b>${activeMinds(sim.colony).length}</b> minds (max 8) · <b>${all.length}</b> ever lived · generation <b>${maxGen}</b> · tick ${sim.world.tick}` +
    `<div class="note">${speed === 'pause' ? 'Paused: nothing moves, no mind thinks.' : `Speed <b>${speed}</b>: one thought every ${PACES[speed].gapMs / 1000} s at most${sim.llm ? ' (each one is a paid model call)' : ' (demo minds, free)'}.`}</div>` +
    (sim.status ? `<div class="note">${esc(sim.status)}</div>` : '') +
    (sim.lastError ? `<div class="err">${esc(sim.lastError)}</div>` : '')
  const conv = conventions(alive, sim.rules)
  $('conventions').innerHTML = `<div class="big">${conv.total}</div>` +
    conv.words.slice(0, 8).map((w) => `<span class="chip">${esc(w.word)} <small>×${w.minds}</small></span>`).join('') +
    conv.rules.slice(0, 4).map((r) => `<span class="chip rule">${esc(r.sig)} <small>×${r.minds}</small></span>`).join('')
  $('thoughts').innerHTML = sim.thoughts.slice(-12).reverse().map((t) => {
    const o = sim.colony.orgs.get(t.id)
    return `<li><b style="color:hsl(${o?.hue ?? 0} 80% 70%)">#${t.id}</b> ${esc(t.text)}${t.self ? `<br><small class="who">${esc(t.self)}</small>` : ''}</li>`
  }).join('')
  renderFeed()
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
  const max = Math.max(1, o.size * MAX_ENERGY_PER_CELL)
  const bar = (v: number, color: string) => `<span class="bar"><i style="width:${Math.round(Math.min(1, Math.max(0, v)) * 100)}%;background:${color}"></i></span>`
  const chain = lineage(sim.colony, o.id).map((id) => sim.colony.orgs.get(id)!).filter(Boolean)
  $('selbody').innerHTML = `<p>${o.alive ? `${o.size} cells, generation ${o.gen}` : `gone: ${esc(o.fate)}`}` +
    `${o.thinking ? ' · <i>thinking…</i>' : ''}${o.whisper ? ' · whisper pending' : ''}</p>` +
    `<p class="who"><small>who I am</small><br>${esc(o.self || '(has not said yet)')}</p>` +
    `<p><small>energy</small> ${bar(o.energy / max, o.energy <= 0 ? '#e86a5f' : o.hungry ? '#f0a24a' : '#5fd07a')} ${Math.round(o.energy)}${o.hungry ? ' · hungry' : ''}</p>` +
    `<p><small>walking</small> ${o.heading ?? 'no'} · <small>fusion</small> ${o.fusion}</p>` +
    `<p class="thought">${esc(o.thought || '(no thought yet)')}</p>` +
    `<p><small>says</small> “${esc(o.say)}”</p>` +
    `<p><small>nature (inherited)</small></p><table class="traits">${TRAITS.map((t) => `<tr><td>${t}</td><td>${bar(o.temperament[t], `hsl(${o.hue} 70% 60%)`)}</td><td>${o.temperament[t].toFixed(2)}</td></tr>`).join('')}</table>` +
    `<p><small>lineage: how the nature drifted</small> (max drift ${drift(sim.colony, o.id).toFixed(2)})</p><table class="traits lineage"><tr><th></th>${TRAITS.map((t) => `<th>${t.slice(0, 4)}</th>`).join('')}</tr>` +
    chain.slice(0, 6).map((a) => `<tr><td>#${a.id}</td>${TRAITS.map((t) => `<td>${a.temperament[t].toFixed(2)}</td>`).join('')}</tr>`).join('') + `</table>` +
    `<p><small>what happened to me</small></p><ul>${o.diary.slice().reverse().map((m) => `<li>${esc(m)}</li>`).join('') || '<li>(nothing yet)</li>'}</ul>` +
    `<p><small>notes</small></p><ul>${o.memory.map((m) => `<li>${esc(m)}</li>`).join('') || '<li>(none)</li>'}</ul>` +
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
let lastFrame = performance.now()
let acc = 0
function loop(now: number): void {
  sim.idle = now - lastInput > IDLE_MS
  const pace = PACES[speed]
  const due = stepsDue(acc, now - lastFrame, pace.stepsPerSecond)
  acc = due.acc
  lastFrame = now
  for (let k = 0; k < due.steps; k++) frame(sim)
  if (speed !== 'pause') think(sim, now, THINK_MS, pace.gapMs, { demoGapMs: pace.gapMs, demoLatencyMs: pace.demoLatencyMs })
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
  // Hand the minds back to the real clock; keep the last thought on screen for a while.
  for (const o of sim.colony.orgs.values()) (o.nextThink = 0), (o.bubbleUntil = 0)
  sim.nextThoughtAt = 0
  for (const t of sim.thoughts.slice(-1)) {
    const o = sim.colony.orgs.get(t.id)
    if (o?.alive) o.bubbleUntil = performance.now() + 4 * BUBBLE_MS
  }
}
if (params.has('autoselect')) selected = activeMinds(sim.colony)[0]?.id ?? null
renderPanel()
draw()

// For headless screenshots and curious consoles.
Object.assign(window, { hillary: { get sim() { return sim }, ruleSignature, select: (id: number) => (selected = id) } })

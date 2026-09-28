// "What's happening": the colony's life told in plain sentences, one line per event, so a
// visitor can follow births, splits, fusions and new habits without reading the rules.

import type { Dir, Rule } from './world.ts'

export type FeedKind = 'born' | 'divided' | 'merged' | 'dissolved' | 'rule' | 'word'

export interface FeedEvent {
  /** Increasing sequence number (stable key for the UI). */
  n: number
  tick: number
  kind: FeedKind
  /** The body a click on this line selects: the one that carries on. */
  id: number
  text: string
  /** Births get their "has a mind / not yet" ending once the minds are re-ranked. */
  settled: boolean
}

export interface Feed {
  events: FeedEvent[]
  seq: number
}

export const FEED_MAX = 60

export const createFeed = (): Feed => ({ events: [], seq: 0 })

export function pushFeed(feed: Feed, tick: number, kind: FeedKind, id: number, text: string): FeedEvent {
  const e: FeedEvent = { n: ++feed.seq, tick, kind, id, text, settled: kind !== 'born' }
  feed.events.push(e)
  if (feed.events.length > FEED_MAX) feed.events.splice(0, feed.events.length - FEED_MAX)
  return e
}

const ids = (xs: number[]) => {
  const t = xs.map((x) => '#' + x)
  return t.length <= 2 ? t.join(' and ') : `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`
}

export const bornText = (id: number, cells: number) => `${cells} cells fused into body #${id}`
export const dividedText = (parent: number, kids: number[]) => `#${parent} split into ${ids(kids)}; they keep its memory`
export const mergedText = (absorbed: number, into: number) => `#${absorbed} was absorbed by #${into}`
export const dissolvedText = (id: number, minSize: number) => `#${id} fell apart (under ${minSize} cells, it is no longer a body)`

/** Finish a birth line once we know whether the newcomer ranks among the thinking bodies. */
export function settleBirths(feed: Feed, hasMind: (id: number) => boolean, maxMinds: number): void {
  for (const e of feed.events) {
    if (e.settled) continue
    e.settled = true
    e.text += hasMind(e.id) ? ' — it now has a mind' : ` — too small to think (only the ${maxMinds} biggest bodies do)`
  }
}

const WHERE: Record<Dir, string> = {
  up: 'above it', down: 'below it', left: 'on its left', right: 'on its right',
  side: 'beside it', diag: 'diagonal to it', any: 'touching it',
}

/** A rule in plain English, from the point of view of the body that obeys it. */
export function describeRule(r: Rule): string {
  const where = WHERE[r.dir] ?? 'touching it'
  const pct = `${Math.round(r.chance * 100)}% per touch`
  let what: string
  if (r.neighbor === 'plant' && r.toNeighbor === 'life') what = `eat plants ${where}`
  else if (r.neighbor === 'empty' && r.toNeighbor === 'life') what = `grow into empty space ${where}`
  else if (r.neighbor === 'life' && r.toNeighbor === 'life' && r.toSelf !== 'life') what = `give its cells to the body ${where}`
  else if (r.neighbor === r.toNeighbor) what = `leave ${r.neighbor} ${where} as it is`
  else what = `turn ${r.neighbor} ${where} into ${r.toNeighbor}`
  if (r.toSelf !== 'life' && !what.startsWith('give')) what += `, its own cell becoming ${r.toSelf}`
  return `${what} (${pct})`
}

const sig = (r: Rule) => `${r.neighbor}@${r.dir}->${r.toSelf}+${r.toNeighbor}`

/** Rules a mind just adopted that it did not have before (chance tweaks do not count). */
export function newRules(before: Rule[], after: Rule[]): Rule[] {
  const had = new Set(before.map(sig))
  return after.filter((r) => !had.has(sig(r)))
}

export const ruleText = (id: number, r: Rule) => `#${id} changed its body's rules: now it will ${describeRule(r)}`

/** A word counts as adopted when this mind says it for the first time and another living mind said it first. */
export function adoptedWords(saidBefore: string[], saidNow: string[], othersSaid: Set<string>): string[] {
  const had = new Set(saidBefore)
  return [...new Set(saidNow)].filter((w) => !had.has(w) && othersSaid.has(w))
}

export const wordText = (id: number, word: string) => `#${id} adopted the word “${word}” from a neighbour`

# The garden

Aunt Hillary is grown, not built. Instead of piling up features, it is tended in **seasons**: look at
the colony, pick the one thing that is weakest, change as little as possible, look again, and keep the
change only if it helped without breaking anything else. A season is a selection, not a construction.

The goal is a small world where something worth watching emerges on its own: bodies that live, die
and have children, minds that become someone, talk to each other, and invent a few words, while the
page stays simple enough to understand in a minute.

## How a season works

1. **Observe (before).** The real engine runs for 5 minutes at Normal speed with real model minds and
   a fixed seed. A script computes the dashboard below, and a human-readable transcript is read too:
   numbers say *where*, transcripts say *why*.
2. **Choose** the weakest dimension and write one falsifiable hypothesis: "if I change X, dimension D
   goes up, and nothing else drops".
3. **Change little**: one constant, one rule, one line of prompt, one mechanic. Removing beats adding.
   Tests stay green.
4. **Observe (after)** with the same protocol and seed.
5. **Keep or pull out.** Kept only if D went up and nothing collapsed, cost and complexity included.
   Otherwise reverted, and said so here.

Caveat: model minds are not deterministic, so one run per side is a coarse measure. A season that
looks like noise is treated as noise.

## The dashboard

| # | Dimension | What is measured |
|---|-----------|------------------|
| 1 | Life | living bodies over time; births, deaths, divisions per minute |
| 2 | Individuality | distinct "I am" among thinking bodies; spread of inherited traits |
| 3 | Evolution | deepest generation; trait drift parent → child; inherited stories later rewritten |
| 4 | Bonds | gifts, fusions, refusals; replies that name another `#id`; pairs that recur |
| 5 | Language | invented words said by ≥ 2 minds and still in use a minute later |
| 6 | Self | how much "I am" stays the same from one thought to the next; references to its own past |
| 7 | Moments | nameable events per minute at Slow speed (target: one every 20–30 s) |
| 8 | Cost | € per hour at Normal speed (guardrail: ≤ 0.60 €/h) |
| 9 | Complexity | legend lines (≤ 7), system prompt size, actions offered to a mind |

**Budget rule:** a season adds at most one concept, and first tries to remove one.

## Seasons

### Season 1 — bodies that divide (kept)

**Seen before.** In five minutes, nobody ever divided. One body swallowed every newcomer by fusion,
grew to 145 cells, said it would *"stay under the split threshold"*, and starved to death at the end
of the run. Maximum generation: 0.

**Hypothesis.** If a body divides past 90 cells instead of 150, Evolution rises above generation 0
without lowering Life, Individuality, Cost or Complexity.

**Change.** `DIVIDE_SIZE` 150 → 90 (the prompt now reads the constant instead of a hard-coded number).

| Dimension | Before | After |
|-----------|--------|-------|
| Life: mean living bodies · divisions/min · bodies ever | 3.07 · 0 · 8 | 3.53 · 0.79 · 17 |
| Individuality: distinct "I am" · trait spread | 2.93 · 0.20 | 3.10 · 0.17 |
| Evolution: max generation · children · stories rewritten | 0 · 0 · — | 4 · 8 · 4/8 |
| Bonds: fusions · refusals · gifts · replies naming another | 4 · 3 · 0 · 6/75 | 7 · 4 · 0 · 15/73 |
| Language: invented words shared and alive | 0 | 0 |
| Self: continuity · replies about its past | 0.89 · 10/75 | 0.87 · 13/73 |
| Moments at Slow: seconds between two | 18 | 12 |
| Cost €/h | 0.37 | 0.37 |
| Complexity: legend · prompt tokens · actions | 5 · 441 · 8 | 5 · 441 · 8 |

**Verdict.** Kept. Evolution went from nothing to four generations; trait spread dipped slightly
(children start close to their parent), which is expected. Moments now come every ~12 s at Slow, busier than the 20–30 s target: to watch,
not yet noise. Still weakest: **Language** (no shared
invented word yet) and **gifts** (nobody gives energy).

### Season 2 — a tongue nobody was given (pulled out)

**Seen before.** Minds talk, but in plain functional English: *"Plants NW, low energy here"*,
*"Hello #6, share map data?"*. Nothing in the prompt suggests their words could be their own, so
nothing is coined and nothing spreads. A second "before" run on the unchanged code also showed how
noisy one run is: same seed, maximum generation 1 instead of season 1's 4.

**Hypothesis.** If the prompt says no language was given and that they speak only words they made up
or heard from other bodies, Language rises above zero without lowering Bonds.

**Change.** One line of the system prompt (the `say` action).

| Dimension | Before | After |
|-----------|--------|-------|
| Life: mean living bodies · divisions/min · bodies ever | 3.33 · 0.20 · 10 | 3.17 · 0 · 7 |
| Individuality: distinct "I am" · trait spread | 3.13 · 0.18 | 3.03 · 0.17 |
| Evolution: max generation · children | 1 · 2 | 0 · 0 |
| Bonds: fusions · refusals · gifts · replies naming another | 3 · 2 · 0 · 16/75 | 2 · 3 · 0 · 2/75 |
| Language: invented words said · shared and alive | 3 · 0 | 2 · 0 |
| Self: continuity · replies about its past | 0.93 · 12/75 | 0.96 · 5/75 |
| Moments at Slow: seconds between two | 20 | 26 |
| Cost €/h | 0.38 | 0.39 |
| Complexity: legend · prompt tokens · actions | 5 · 441 · 8 | 5 · 467 · 8 |

**Verdict.** Pulled out. The minds read "no language was given" as "use only the words you were
given": they fell back on the prompt's own vocabulary (*"plants south?"*, *"need plants NE"*), half
the lines went silent, and replies naming a neighbour dropped from 16 to 2. A prohibition shrinks
speech instead of growing it. Lesson for the next try: coining a word has to *do* something for the
speaker (a reason, not a rule), or it will not happen.

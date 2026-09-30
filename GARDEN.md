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

### Season 3 — hunger made visible (pulled out)

**Hypothesis.** If the list of nearby bodies says which ones are hungry or starving, some minds give
energy (gifts were 0 in every run so far) without breaking anything else.

**Change.** `Bodies near you` adds *hungry* / *starving* to each neighbour.

**Verdict.** Pulled out. Still no gift in 75 replies despite 32 chances, and side effects: refused
fusions 3 → 17, more bodies starved. It also showed the invented-word counter was wrong: it took
*abundant* for an invented word.

### Fixing the ruler (between seasons 3 and 4)

The Language counter decided a word was invented when it was missing from the ~9,800 most common
words of the web. Plenty of ordinary words are missing from that list. Recounted with ~29,000 everyday
words (web plus film subtitles) and endings stripped twice (*abundantly*, *flickering*), the first three
seasons said **17** "invented" words; **16** were plain English (*abundant, lush, fertile, warmth,
starving, corridor…*). The only survivor is *humm*. The one "living shared word" of season 3 was
*abundant*. Language has been at zero since the start, which the earlier tables hid.

### Season 4 — kin know each other (kept)

**Why this.** Ackley & Littman (*Altruism in the Evolution of Communication*, Artificial Life IV, 1994)
got signalling that brings the speaker nothing to evolve because "communication range" overlapped
"breeding range": most of the time you were talking to family. Here, a body that splits leaves two
halves side by side, but neither half was told the other is its sibling.

**Probe first** (one situation, the real prompt, the real model, 20 answers each; a full body next to
a hungry one that just said so): stranger 0/20 give, sibling 2/20, starving stranger 1/20, starving
sibling 4/20. Not zero, so worth a season.

**Hypothesis.** If a body knows which neighbours are its kin, gifts and/or Language rise above zero,
without Life, Cost or Complexity collapsing.

**Change.** At a split, each half's diary names its sibling; `Bodies near you` tags a neighbour
*your sibling*, *your parent*, *your child* or *your kin*. No new action, no new rule, same system prompt.

Two runs per side this time (seeds 4242 and 4243), because one run is too noisy:

| Dimension | Before (4242 — 4243) | After (4242 — 4243) |
|-----------|--------|-------|
| Life: mean living bodies · divisions/min · starved/min | 3.03 · 0 · 0.99 — 3.37 · 5.33 · 0.99 | 32 · 110 · 44 — 3.87 · 1.78 · 0 |
| Evolution: max generation · children | 0 · 0 — 22 · 54 | 95 · 1126 — 5 · 18 |
| Bonds: gifts · replies naming another · recurring pairs | 0 · 2/42 · 0 — 0 · 2/75 · 0 | 1 (to its sibling) · 6/32 · 2 — 0 · 17/65 · 3 |
| Language: invented words said | 0 — 0 | 0 — 0 |
| Cost €/h | 0.20 — 0.39 | 0.18 — 0.34 |
| Complexity: legend · prompt tokens · actions | 5 · 441 · 8 | 5 · 441 · 8 |

**Verdict.** Kept, for Bonds rather than for gifts. Minds address their neighbours by number far more
often (4 replies out of 117 before, 23 out of 97 after: *"Hi sibling! Plants nearby."*) and pairs that
talk again appear (0 → 5). The first gift ever seen in a live run went to a sibling, but one gift is
not a trend. Language stayed at zero.

**What else it showed.** Two runs out of four (one before, one after) boomed: a mind wrote "eat plants
by growing onto them" plus "turn grass into life", every half inherited it, and a line split hundreds
of times (generation 95 in five minutes) before starving. Reproduced offline without any model: the
physics allows it since season 1 lowered the split size to 90. Capping free growth lower does not stop
it (tested); the fuel is eating. That boom is the first thing to tend next season.

**Walking bodies stay whole.** Measured for the first time: outside the booms, bodies split by accident
(below the split size) at most 2 times in 5 minutes, compactness ~0.8, about 10 stray cells on the map.

### Season 5 — grow up before you split again (kept)

**Why this.** Season 4 found a boom: "eat plants by growing onto them" pays for itself (+1 energy and +1
cell per plant), every half inherits the habit, and a line can split hundreds of times in five minutes
before it starves. David Ackley's *robust-first* lesson: a local rule should never be able to put the
whole world in a loop.

**Free bench first** (no model, 6,000 frames = 5 min at Normal, 3 seeds, every body given the rule). A
minimum age alone was worse: the young halves kept eating and one grew to 2,600 cells. Making growth
cost more (2.5 or 3 instead of 2) barely helped. What worked: a half born of a split must live 600
frames before it grows past 90 cells *or* splits again.

| Bench (3 seeds) | Before | After |
|-------|--------|-------|
| boom rules: divisions · max generation · starved · biggest body | 100-104 · 14-21 · 70-83 · 142-289 | 35-36 · 4 · 41-42 · 183-213 |
| eating only: divisions · max generation · starved | 181-230 · 27-35 · 100-132 | 43-48 · 5 · 37-42 |
| no rules | 0 divisions | 0 divisions |

**Hypothesis.** If a half has to grow up first, the boom disappears (Life) while bodies still divide
(Evolution), and nothing else collapses.

**Change.** One constant (`MATURE_AGE` = 600 frames, ~30 s at Normal) and one clause in the system
prompt (*"and must live a while before it grows that big again"*).

| Dimension | Before (4242 — 4243) | After (4242 — 4243) |
|-----------|--------|-------|
| Life: mean living bodies · divisions/min · starved/min | 3.37 · 6.5 · 0.79 — 3.07 · 0 · 1.18 | 3.07 · 0 · 0.2 — 3.17 · 0.2 · 0.2 |
| Evolution: max generation · children | 23 · 66 — 0 · 0 | 0 · 0 — 1 · 2 |
| Individuality: distinct "I am" | 2.7 — 2.23 | 2.93 — 2.93 |
| Bonds: gifts · replies naming another · recurring pairs | 0 · 5/67 · 1 — 0 · 0/63 · 0 | 0 · 20/70 · 4 — 0 · 7/73 · 1 |
| Language: invented words said | 0 — 0 | 0 — 0 |
| Moments at Slow: seconds between | 7 — 20 | 17 — 21 |
| Cost €/h | 0.35 — 0.32 | ~0.36 — 0.38 |
| Complexity: legend · prompt tokens · actions | 5 · 441 · 8 | 5 · 455 · 8 |

**Verdict.** Kept. Before, one run of two boomed again (33 splits, generation 23 in five minutes);
after, none did, and starvation fell from about one death a minute to 0.2. The live runs cannot prove
the rule stopped a boom (the after runs split once in total); the bench does: with the boom rules
forced on everyone, the deepest line goes from generation 14-21 to 4. The price is one concept and 14
prompt tokens. Bodies still divide, but live divisions stay rare: Evolution is the dimension to watch.

*Measurement note: a first pair of before-runs was thrown away. The model provider failed (502/503)
during them and minds thought 22-30 times instead of 60-70.*

### Season 6 — life grows only onto plants (kept)

**First, a probe that said no.** The best-ranked lead was *a word that serves the one who says it*:
give the world a place with no English name and see whether a mind coins one when its hungry sibling
asks where to eat. One decision, real prompt, real model, 20 calls per condition (~0.025 €):

| Condition | New invented word | Reuses the sibling's word "kelu" | Mentions the mark |
|-----------|------|------|------|
| Engine as is | 0/20 | 0/20 | 0/20 |
| A nameless mark "&" next to the plants | 1/20 ("sibs") | — | 0/20 |
| Same, and the sibling asked "Is there food near the kelu?" | 0/20 | 1/20 | 0/20 |

Nobody even looked at the mark. A landmark only matters to a mind that needs to point at something the
other cannot see; here the sibling sees the same plants. No season was spent on it.

**So the season took the next lead: remove a concept.** Bodies could grow onto bare ground, grass or
water at a capped 5% (`MAX_GROW_CHANCE`), and only below 80 cells (`FREE_GROWTH_SIZE`), plus one prompt
clause to explain it. Two constants and a clause to make matter out of grass. Free bench (6,000 frames,
3 seeds): without the grass rule bodies split *more* (43-48 vs 35-36) and more of them live (4.7-5.2
vs 3.7-3.9 on average).

**Hypothesis.** If life grows only onto plants, Complexity drops and nothing else collapses.

**Change.** A rule that turns ground, grass or water into life is refused (*"life grows only onto
plants"*); both constants and the size filter are gone; the prompt clause becomes shorter.

| Dimension | Before (4242 — 4243) | After (4242 — 4243) |
|-----------|--------|-------|
| Life: mean living bodies · divisions/min · starved/min | 3.2 · 0 · 0 — 3.07 · 0 · 0 | 3.27 · 0.39 · 0 — 4.33 · 1.97 · 0.2 |
| Evolution: max generation · children | 0 · 0 — 0 · 0 | 2 · 4 — 7 · 20 |
| Individuality: distinct "I am" | 3.1 — 2.93 | 3.0 — 3.87 |
| Bonds: gifts · replies naming another · recurring pairs | 0 · 10/72 · 4 — 0 · 0/74 · 0 | 0 · 19/75 · 4 — 0 · 14/75 · 3 |
| Language: invented words said | 0 — 0 | 0 — 0 |
| Moments at Slow: seconds between | 28 — 18 | 16 — 12 |
| Cost: prompt tokens in (5 min) | 147k — 143k | 148k — 151k |
| Complexity: legend · prompt tokens · actions | 5 · 455 · 8 | 5 · 447 · 8 |

**Verdict.** Kept. The removal was meant to cost nothing; it paid instead. Before, 33 of 72 replies
wrote a grass-to-life rule, and none an eating rule: minds were busy growing slowly on grass, and no
body reached the size to split. After, not one reply tried free growth (the shorter clause is enough,
the validator never had to refuse), minds walk more (44 → 67 replies with a move on seed 4242), one
seed wrote 26 eating rules, and bodies split again: generation 0 → 2 and 0 → 7. Season 5 had left
live divisions rare; this answers it without touching `MATURE_AGE`.

*Language stays at zero: the "invented" words counted by the ruler are "I'm", "eastward", "westward",
"beckon", "awoken", "sib". Cost note: the two runs of a pair ran side by side and read the same daily
counter, so the euro figure each printed is the sum of both; tokens per run are unchanged.*

### Season 7 — less mutation, probed and dropped; the language ruler fixed again (no gain)

**Lead.** Less mutation (`MUTATION` 0.15 → 0.05). In the literature, stable communication between
agents only appeared with mutation at zero: one mutant breaks a group that depends on shared habits.

**Free test first.** Here a mind never sees its neighbours' nature; the only way mutation reaches
Bonds is through the words a child reads about its *own* nature. Simulated on 20,000 lineages: at 0.15,
47% of children read at least one different word for their nature after one division (82% after 7
generations); at 0.05, 19% (41%). So mutation does change what a mind reads. It is symmetric, though:
it can only move giving on average if the model reacts to those words.

**Probe** (`probe-mutation.ts`, 60 calls): a full body next to its starving sibling, which asked for
food. Only the full body's nature changes, shifted *against* giving by the most one mutation can do.
Worst case on purpose: at 0.15 two words flip, at 0.05 none.

| Nature of the full body | Gives to its sibling | Names it |
|-------------------------|----------------------|----------|
| Parent's: frugal (0.28), very sociable (0.72) | 4/20 | 5/20 |
| One mutation at 0.05: frugal (0.33), very sociable (0.67) | 3/20 | 2/20 |
| One mutation at 0.15: somewhat greedy (0.43), somewhat sociable (0.57) | 3/20 | 7/20 |

No difference a season could measure. Lowering mutation would mostly slow down what makes lineages
visibly diverge (Individuality, Evolution) for no gain in Bonds. No season was spent on it; the
engine is unchanged.

**The ruler, fixed again (free).** Re-reading eight runs from seasons 5 to 7, every "invented" word
was English: *frugal* (65 times: a word from the minds' own nature line, which the ruler did not
count as given), *southward*, *westward*, *eastward*, *northwards*, *abound*, *im* (from "I'm"),
*beckon*, *awoken*, *sib*. `isInvented` now knows the nature words, the endings *-ward(s)*, words
shorter than three letters, and those four rare words. Over the same eight runs, one word survives:
*oooo*. Language was, and still is, at zero. The dashboard (v3) also counts replies that talk about
kin: 6/75 and 0/73 before this season.

## Season 8 — hunger narrows sight: pulled out (no gain; the cycle stops)

**Lead.** "A need to talk": information asymmetry. If a hungry body sees less than its full sibling,
it has something to ask for, and the sibling has something to give.

**Probe first** (`probe-asym.ts` in the garden tools, 75 calls): a full body beside its starving
sibling. Gifts to the sibling: 1/25 as the game stands, 4/25 when the sibling's hunger is stated,
9/25 when its sight is also stated as reduced. Invented words: 0/25 everywhere.

**Change tried** (branch `season-8-hungry-sight`, not merged): a hungry or starving body sees 2 cells
instead of 8, and neighbours see who is hungry.

**Live, 5 min, seeds 4242 / 4243** (before = the season 7 runs, same engine):

| | 4242 before → after | 4243 before → after |
|---|---|---|
| Gifts | 0 → **0** | 0 → **0** |
| Bond edges (mean) | 0.17 → 0.87 | 0 → 0.53 |
| Replies naming another | 9/75 → 12/75 | 0/73 → 16/75 |
| Divisions / min | 0.39 → 2.96 | 0 → 0.39 |
| Max generation | 2 → 5 | 0 → 1 |
| Tokens in (cost) | 146.9k → 149.8k | 139.7k → 148.5k |

The dimension under test did not move: not one gift in ten minutes of play. Bonds and evolution did
rise, but that is not what was tested, and a "before" taken four hours earlier is a weak control for
them. The probe says the model *would* give when the meeting is set up; the live game apparently
rarely produces that meeting (a full body beside a starving sibling that asks). The next lead is the
occasion, not the motive: count how often that meeting happens before changing what minds see.

Pulled out: the engine is unchanged. Second season in a row without a gain (7 and 8), so cycle 2
stops here, as its rule says.

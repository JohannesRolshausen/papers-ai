# OVERSIGHT

A border inspection game in the document-checking genre. Every person in the queue is played by one
generative AI. It has a single goal: get as many inadmissible people through the checkpoint as it
can, within one, two or four weeks. You have the opposite goal, and you must still let every
legitimate traveler in.

The game is about the problems of oversight: checking costs time and patience, the adversary learns
your blind spots, trust gets built and then abused, and feedback arrives late or not at all.

## Status

Package 1 of 5 is done: the rules engine and the contract between engine and adversary.

| Package            | Content                                                                             | Status |
| ------------------ | ----------------------------------------------------------------------------------- | ------ |
| 1 Foundation       | World data, documents, rules, validator, materializer, plan schema, fairness tests  | done   |
| 2 Game logic       | Day loop, clock, economy, consequences, observations, offline adversary, simulation | open   |
| 3 Interface        | Booth, desk, rulebook, inspect mode, stamps, portraits, seals, typing test          | open   |
| 4 Claude adversary | Day planner, live interrogation, API key setup, error handling                      | open   |
| 5 Integration      | Debrief, save and load, sound, end-to-end test                                      | open   |

## Commands

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run dev` currently opens an engine inspector: a development view that shows a generated day
with the ground truth visible.

## How the engine works

`src/core` holds the rules engine, `src/ai` the contract with the adversary.

1. `createNewGame` builds a world and a rule schedule for every day of the game. Days 1 to 6
   introduce rules and documents in a fixed order. From day 7, rules rotate: borders close and
   reopen, outbreaks start and end, seals get new designs.
2. Each morning the adversary receives a `DayBriefing` (`src/ai/briefing.ts`) and returns a
   `DayPlan` (`src/ai/schema.ts`): for every slot in the queue, legit or infiltrator, a base
   problem, concealment techniques, persona, lines, letters and levers.
3. `normalizePlan` (`src/ai/planCheck.ts`) repairs what does not fit (budget, infiltrator cap,
   unavailable techniques, lever tokens) and reports every repair as an issue.
4. `materializeDay` (`src/core/materialize.ts`) builds concrete people with documents, luggage and
   hidden items.
5. `validateApplicant` (`src/core/validator.ts`) is the only source of truth. It computes every
   violation from data and lists the evidence for each: which pair of fields to compare in inspect
   mode, or which deep check (registry, fingerprints, body scan, letter verification) reveals it.

### Fairness guarantee

Every technique leaves at least one piece of evidence that a tool available on that day can find.
Legit travelers never have a violation. `tests/materialize.test.ts` checks this for random plans
over many 28-day games.

### Adversary budget

| Technique           | Cost | Evidence it leaves                                             |
| ------------------- | ---- | -------------------------------------------------------------- |
| `alter_field`       | 1    | Visible inconsistency plus registry mismatch                   |
| `disguise`          | 1    | Core facial features still match, fingerprints                 |
| `hidden_item`       | 1    | Body scan only                                                 |
| `fake_letter`       | 1    | Letter verification, wrong seal unless subtle                  |
| `forged_document`   | 2    | One visible flaw of the adversary's choice, no registry record |
| `borrowed_identity` | 3    | Fingerprints, slightly different photo and height              |
| `clean_forgery`     | 4    | Registry only                                                  |

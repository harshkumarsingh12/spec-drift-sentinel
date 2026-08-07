# Spec Drift Sentinel

**Keeps code honest to its specification.**

Built for **Deploy or Die** — HowToAlgo x GDG on Campus KIIT, Track B (Developer Productivity Tools).

---

## The problem

When an end-to-end test fails, two very different things may have happened:

| | What it means | What should happen |
|---|---|---|
| **Regression** | The code broke a contract the spec still asserts | The test is right. CI stays red. |
| **Intentional contract change** | The spec moved; the test is stale | The test should be updated — deliberately |

Nothing in a normal CI run tells you which. So teams treat both the same way: rewrite the
test until the pipeline goes green. That trains people to silence tests without asking which
situation they were in, and specifications rot into fiction.

## What we're building

Spec Drift Sentinel makes that call explicit.

1. It parses the acceptance criteria out of `spec/PRD.md`.
2. It maps each criterion to the code and tests that claim to implement it.
3. When a test fails, it classifies the failure as a **regression** or an **intentional
   contract change** — and to call something intentional it must cite the exact acceptance
   criterion that authorises it.
4. For a regression, CI stays red and the broken contract is named. No test is touched.
5. For an authorised change, it drafts an updated test and sends it to the **web dashboard**
   as a proposal, alongside the criterion it cites.
6. A human approves or rejects. Only then is anything applied.
7. Every decision — automated and human — lands in an append-only audit log.

A verdict that cannot cite a real criterion is downgraded to a regression. The model cannot
argue its way past that check; it's enforced in code, not in the prompt.

## The web dashboard

The approval gate is a real interface, not a CLI prompt. Four views:

| View | Purpose |
|---|---|
| **Drift inbox** | Every pending verdict awaiting human ratification |
| **Diff viewer** | The proposed test change side by side with the criterion cited as authorisation, plus approve / reject |
| **Traceability matrix** | Acceptance criterion → code → tests, colour-coded by coverage status |
| **Audit timeline** | Every decision in order: verdict, reasoning, who ratified it, when |

The diff viewer is the heart of it. Showing the proposed change *next to* the criterion that
supposedly permits it means the reviewer can check the claim rather than trust it.

---

## Architecture

### Design principle

**Determinism where determinism is possible.** Exactly one question in this system needs a
language model: *did the specification authorise this behaviour change?* Everything else —
parsing criteria, walking the import graph, building the traceability map, recording
decisions — is ordinary computation and is written as such.

This keeps the unreliable surface small and auditable. It also means the deterministic half
works with no API key at all, which is what you fall back on when free-tier quota runs out.

### Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 — deterministic  (no LLM, no API key required)         │
│                                                                 │
│    src/analyzers/architecture.ts   import-graph rule checks     │
│    src/analyzers/traceability.ts   AC → code → test mapping     │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2 — agent-driven                                         │
│                                                                 │
│    src/agent/classifier.ts   regression vs intentional change   │
│    src/agent/proposer.ts     drafts a candidate test diff       │
│    src/agent/provider.ts     NVIDIA → Groq failover on 429      │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  Ratification and record                                        │
│                                                                 │
│    web/             dashboard: inbox, diff viewer, matrix       │
│    src/audit/log.ts append-only JSONL decision log              │
└─────────────────────────────────────────────────────────────────┘
```

### Flow

```
spec/PRD.md ──┐
              ├──> traceability map (AC → code → tests)
codebase ─────┘
                     │
git diff ────────────┤
                     ▼
           affected criteria identified
                     │
       test run → failures
                     ▼
         ┌──── drift-classifier ────┐
         │ regression? intentional? │
         └────────────┬─────────────┘
    regression        │        intentional_change (must cite an AC)
         │            │              │
   CI stays red,      │      propose-playwright-test
   contract named,    │      drafts a diff
   no test touched    │              │
         │            │              ▼
         └────────────┴──────> dashboard: human approves or rejects
                                      │
                                      ▼
                              audit log (append-only)
```

### The custom agent and skill

| | Name | Role |
|---|---|---|
| **Agent** | `drift-classifier` | Decides regression vs intentional change. Must cite an `AC-n`; the citation is verified against the parsed spec, not trusted. |
| **Skill** | `propose-playwright-test` | Drafts the updated test. Throws if handed anything other than an authorised intentional change. |

Both are documented in detail in [`AGENTS_AND_SKILLS.md`](AGENTS_AND_SKILLS.md).

### Safety properties

Enforced in code and covered by tests — not merely intended:

1. An `intentional_change` citing a criterion that doesn't exist is downgraded to
   `regression`.
2. `propose()` throws unless the verdict is an authorised `intentional_change` whose cited
   criterion matches the one supplied.
3. No code path writes a proposed diff to a test file. Application requires a human decision.
4. Deterministic checks run correctly with no provider configured.

### Data model

`src/types.ts` is the **frozen contract** between the analysis backend and the dashboard.
The frontend builds against mocks shaped like these while the backend is still being written,
so neither half of the team blocks the other.

| Type | Purpose |
|---|---|
| `AcceptanceCriterion` | An `AC-n` parsed from the PRD, with its prose and source line |
| `TestFailure` | A failing test, normalised from the runner's report |
| `Verdict` | Kind, cited AC, confidence, reasoning, optional proposed diff |
| `AuditEntry` | One append-only row: decision, ratifier, diff hash, timestamp |
| `DependencyRule` / `ArchitectureViolation` | A declared boundary and a concrete breach |
| `TraceabilityRow` | A criterion with the code and tests claiming to cover it |

### Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript on Node 22+ | Playwright is native here; trivial GitHub Actions support |
| Dashboard | Next.js + React | The ratification UI |
| Tests | `node:test` | Built in — no runner dependency, fast CI |
| E2E | Playwright | Tests the dashboard, and is the class of test the tool reasons about |
| LLM primary | NVIDIA Build | Bulk inference loop, free tier, no card |
| LLM fallback | Groq | Fall through on 429 rather than waiting it out |

---

## Getting started

### Prerequisites

- [ ] **Node 22 or newer** — `node --test` needs glob support that Node 20 lacks
- [ ] Git
- [ ] A GitHub account with access to this repo
- [ ] An [NVIDIA Build](https://build.nvidia.com) account → `nvapi-...` key *(save it immediately, it's shown once)*
- [ ] A [Groq](https://console.groq.com) account → `gsk_...` key, as fallback

> **Generate your own keys.** Free-tier limits are per account, so four members with four
> keys is four times the capacity.

### Setup

```bash
git clone https://github.com/harshkumarsingh12/spec-drift-sentinel.git
cd spec-drift-sentinel
npm install               # also creates .env for you from the template
npm test                  # should be green before you change anything

# paste your own keys into .env, then:
npm run check:providers   # confirms both providers actually respond
```

`.env` is created automatically on install and is gitignored — it never gets committed, so
each person's keys stay on their own machine.

### Setup checklist

- [ ] `node --version` reports 22 or higher
- [ ] `npm install` completed without errors
- [ ] `npm test` is green — 47 tests passing
- [ ] `.env` populated with **your own** keys
- [ ] `npm run check:providers` reports 2 working
- [ ] `npm run sentinel -- arch` runs and passes
- [ ] You've read [`CONTRIBUTING.md`](CONTRIBUTING.md) and know which paths you own

## Commands

```bash
npm test                        # build, then run the unit tests
npm run typecheck               # type-check without emitting
npm run build                   # compile to dist/
npm run check:providers         # verify both LLM providers respond

npm run sentinel -- arch        # dependency rules — deterministic, no API key
npm run sentinel -- trace       # acceptance criterion → code → test matrix
npm run sentinel -- trace --strict   # …and fail if any criterion is uncovered
npm run sentinel -- audit       # the decision log
npm run sentinel -- help
```

**Exit codes are a contract**, because the CLI runs as a CI gate:

| Code | Meaning |
|---|---|
| `0` | Clean |
| `1` | Violations or drift found — fail the build |
| `2` | Bad usage or missing configuration |

## Project structure

```
spec/PRD.md              acceptance criteria (AC-n) — the contract
src/
  types.ts               FROZEN shared contract: Verdict, AuditEntry, …
  cli.ts                 entry point, CI-gate exit codes
  config.ts              reads sentinel.config.json
  analyzers/
    architecture.ts      Layer 1 — import-graph dependency rules
    traceability.ts      Layer 1 — AC → code → test mapping
  agent/
    classifier.ts        custom agent: drift-classifier
    proposer.ts          custom skill: propose-playwright-test
    provider.ts          NVIDIA → Groq failover
  audit/log.ts           append-only JSONL decision log
web/                     Next.js dashboard (inbox, diff viewer, matrix, timeline)
fixture-app/             deliberately tiny target app — exists to be broken in the demo
tests/                   unit tests, including the safety guarantees
.github/workflows/ci.yml CI pipeline
```

## How the spec works

Acceptance criteria are declared in `spec/PRD.md` as headings:

```markdown
### AC-2: A test update may only be proposed, never applied
The system may draft an updated test only when …
```

Code and tests claim coverage with an annotation:

```ts
/** @covers AC-2 */
```

Run `npm run sentinel -- trace` to see the current mapping. A criterion nothing claims is
reported as `orphaned` rather than being silently matched to something that looks related.

**Changing an acceptance criterion is how you authorise a behaviour change.** Nothing else
authorises one. If the code moves and no criterion moved with it, the Sentinel calls it a
regression — including on this repository itself.

---

## Checklists

### Submission gate — all five are pass/fail

Miss any one and the submission never reaches a scorer.

- [x] **Architecture document** — [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [x] **Agent rules** — [`AGENTS.md`](AGENTS.md)
- [x] **Working code** — builds, runs, 47 tests passing
- [x] **One custom agent + one custom skill** — documented in [`AGENTS_AND_SKILLS.md`](AGENTS_AND_SKILLS.md)
- [x] **Green CI/CD pipeline** — GitHub Actions, most recent run passing

### Scored deliverables

- [x] Specification / PRD with acceptance criteria — [`spec/PRD.md`](spec/PRD.md)
- [ ] Playwright end-to-end tests, passing in CI, report uploaded as an artifact
- [ ] Code-quality configuration (linter / static analysis, ideally pre-commit)
- [ ] Clean, progressive commit history *(ongoing — commit continuously)*
- [x] Task breakdown — [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md)
- [ ] Tagged release with semantic versioning

### Build checklist

- [x] Repo scaffolded, gate items present, CI green
- [x] Shared type contract frozen (`src/types.ts`)
- [x] Deterministic analyzer working end to end
- [x] Append-only audit log
- [ ] Fixture app + its Playwright tests running in CI
- [ ] Traceability map wired to real diffs
- [ ] Classifier producing verdicts on live failures
- [ ] Dashboard: drift inbox
- [ ] Dashboard: diff viewer with approve / reject
- [ ] Dashboard: traceability matrix
- [ ] Dashboard: audit timeline
- [ ] Tag `v1.0.0`
- [ ] ~3 minute demo video recorded

### Definition of done — before opening a PR

- [ ] `npm test` passes locally
- [ ] `npm run typecheck` is clean
- [ ] `npm run sentinel -- arch` passes
- [ ] New behaviour has a test
- [ ] If behaviour changed, `spec/PRD.md` changed too
- [ ] `@covers AC-n` added to anything implementing a criterion
- [ ] No secrets, no `.env`, no `dist/`, no `node_modules/`

### Demo script

- [ ] **Regression** — break an endpoint in `fixture-app`. Verdict `regression`, CI red, contract named, no test modified.
- [ ] **Intentional change** — edit an AC *and* the matching code. Verdict `intentional_change`, diff proposed in the inbox citing the AC, not applied.
- [ ] **Ratify** — approve in the dashboard, test updates, CI green, both decisions visible in the timeline.
- [ ] **Deterministic** — add an illegal import. Fails with no LLM involved.

---

## Contributing

Four people, one repo. [`CONTRIBUTING.md`](CONTRIBUTING.md) covers setup, who owns which
paths, branching, commit conventions and the definition of done. Read it before your first
commit.

House rules, in short:

1. **Never make a failing test pass by weakening it.** No deleted assertions, no loosened
   matchers, no `.skip`, no inflated timeouts.
2. **Never auto-apply a proposed test change.** A human ratifies. That's the whole point.
3. **Deterministic beats probabilistic.** If a check can be static analysis, it must be.
4. **When uncertain, fail safe** — classify as `regression`, keep CI red, surface the question.

## Documents

| Document | Contents |
|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, path ownership, branching, definition of done |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Full design, data model, safety properties |
| [`AGENTS.md`](AGENTS.md) | Rules for AI agents working in this repo |
| [`AGENTS_AND_SKILLS.md`](AGENTS_AND_SKILLS.md) | The custom agent and skill in detail |
| [`spec/PRD.md`](spec/PRD.md) | Acceptance criteria — the contract |
| [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) | Team brief: plan, work split, demo script |

## Known limitations

- The `@covers AC-n` scanner matches annotations inside string literals, so a test file that
  mentions an id in its fixtures is wrongly credited with covering it.
- `trace` is report-only by default; run with `--strict` once every criterion is expected to
  be covered.

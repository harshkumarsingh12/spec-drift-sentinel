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
- [ ] `npm test` is green — 101 tests passing
- [ ] `.env` populated with **your own** keys
- [ ] `npm run check:providers` reports 2 working
- [ ] `npm run sentinel -- arch` runs and passes
- [ ] You've read [`CONTRIBUTING.md`](CONTRIBUTING.md) and know which paths you own

## Commands

```bash
npm test                        # build, then run the unit tests
npm run typecheck               # type-check without emitting
npm run build                   # compile to dist/
npm run lint                    # ESLint
npm run lint:fix                # ESLint, fixing what it can
npm run check:providers         # verify both LLM providers respond

npm run sentinel -- arch        # dependency rules — deterministic, no API key
npm run sentinel -- trace       # acceptance criterion → code → test matrix
npm run sentinel -- trace --strict   # …and fail if any criterion is uncovered
npm run sentinel -- audit       # the decision log
npm run sentinel -- help

# diagnose a failing test against the spec (needs a provider key)
npx playwright test 2>&1 | npm run sentinel -- classify --propose
npm run sentinel -- classify --failures failures.txt --propose
```

`classify` is the whole pipeline in one command: it reads the acceptance criteria,
takes a git diff and a test-failure log, decides regression vs. authorised change,
optionally drafts a test update, and records the decision in the audit log. It never
writes to a test file — the proposal goes to the dashboard for a human to ratify.

Dashboard and its end-to-end tests live in `web/`:

```bash
cd web
npm run dev                     # http://localhost:3000
npm run test:e2e                # Playwright — builds and starts the app itself
npm run test:e2e:report         # open the HTML report
```

The demo fixture lives in `fixture-app/`:

```bash
cd fixture-app
npm start                       # http://localhost:3100
npm run test:e2e                # 7 specs — these are what you break in the demo
```

**Exit codes are a contract**, because the CLI runs as a CI gate:

| Code | Meaning |
|---|---|
| `0` | Clean |
| `1` | Violations or drift found — fail the build |
| `2` | Bad usage or missing configuration |

`classify` returns `1` for both verdict kinds. A regression is obviously not clean, and
an authorised change still needs a human to ratify it before the build can be green —
nothing has been applied yet.

## Deployment

The dashboard is **not static** — it reads `.sentinel/audit.jsonl` and `spec/PRD.md` from
disk at request time, and Approve/Reject write back to that same file. A static host
(GitHub Pages) or a serverless platform with a read-only filesystem (Vercel's production
functions) would silently break the ratification flow — writes would just fail. It has to
run as a normal, persistent Node process.

**Render** does that, on a free tier, so that's the target. [`render.yaml`](render.yaml) is
a Blueprint describing the service: it builds the root backend, seeds real demo content
through the actual `runClassify` pipeline (deterministic, no network — see
[`web/scripts/seed-audit-log.mjs`](web/scripts/seed-audit-log.mjs)), builds the dashboard,
and starts it bound to Render's `$PORT`.

### One-time setup (do this once, by hand — an Action can't create the account for you)

1. Create a [Render](https://render.com) account (free).
2. Dashboard → **New** → **Blueprint** → connect this GitHub repo. Render reads
   `render.yaml` and provisions the `spec-drift-sentinel` web service automatically.
3. Once created, open the service → **Settings** → **Deploy Hook**, copy the URL.
4. In this GitHub repo: **Settings** → **Secrets and variables** → **Actions** → **New
   repository secret** → name it `RENDER_DEPLOY_HOOK_URL`, paste the URL.

### After that, it's automatic

Pushing a tag matching `v*` (e.g. `git tag v1.0.0 && git push origin v1.0.0`) runs CI
(`.github/workflows/ci.yml`) and, once `verify` and `e2e` both pass:

- **`deploy`** — POSTs the Render deploy hook, triggering a fresh build and rollout.
- **`release`** — creates a GitHub Release for the tag with auto-generated notes.

Writes made through the live dashboard persist for the life of that deploy, but are wiped
on the next redeploy (no persistent disk attached) — acceptable for a demo site, since the
build step reseeds realistic content every time anyway.

## Project structure

```
spec/PRD.md              acceptance criteria — AC-1..6 the product, AC-7..9 the fixture
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
    provider.ts          NVIDIA → Groq failover, with per-request timeout
  commands/classify.ts   orchestration: classify → propose → record
  audit/log.ts           append-only JSONL decision log
web/                     Next.js dashboard (inbox, diff viewer, matrix, timeline)
fixture-app/             the demo prop — a tiny cart API, built to be broken
tests/                   unit tests, including the safety guarantees
.github/workflows/ci.yml CI pipeline
```

**Three npm packages.** The root (CLI + unit tests), `web/` (dashboard + its Playwright specs),
and `fixture-app/` (demo prop + its Playwright specs). Each has its own `package.json`, so check
which directory you are in before wondering why a script does not exist.

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
- [x] **Working code** — builds, runs, 101 tests passing
- [x] **One custom agent + one custom skill** — documented in [`AGENTS_AND_SKILLS.md`](AGENTS_AND_SKILLS.md)
- [x] **Green CI/CD pipeline** — GitHub Actions, most recent run passing

### Scored deliverables

- [x] Specification / PRD with acceptance criteria — [`spec/PRD.md`](spec/PRD.md)
- [x] Playwright end-to-end tests — 18 specs, passing in CI, HTML report uploaded as an artifact
- [x] Code-quality configuration — ESLint, enforced by a pre-commit hook and in CI
- [ ] Clean, progressive commit history *(ongoing — commit continuously)*
- [x] Task breakdown — [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md)
- [ ] Tagged release with semantic versioning

### Build checklist

- [x] Repo scaffolded, gate items present, CI green
- [x] Shared type contract frozen (`src/types.ts`)
- [x] Deterministic analyzer working end to end
- [x] Append-only audit log
- [x] Classifier producing verdicts from real Playwright output — `sentinel classify`
- [x] Proposer drafting test updates, recorded but never applied
- [x] Dashboard: drift inbox
- [x] Dashboard: diff viewer — renders; approve / reject wired up
- [x] **`fixture-app`** — 3 endpoints, 1 screen, 7 Playwright tests
- [x] **Both demo paths rehearsed against a live model** — regression and authorised change
- [x] **Dashboard: approve / reject actually working**
- [x] **Dashboard reading the real `.sentinel/audit.jsonl` instead of mocks**
- [x] Dashboard: traceability matrix built out (scans the real tree for `@covers`)
- [x] Dashboard: audit timeline built out (reads every real row, oldest to newest)
- [ ] `sentinel diff` — git diff → affected criteria
- [ ] Fix the `@covers` false positive (matches ids inside string literals)
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

Both classification paths are **rehearsed and working** against a live model. Run them exactly
like this — the scoped `git diff` matters, see the note below.

**1. A genuine bug → `regression`**

```bash
# break the fee in fixture-app/server.mjs: 4.99 -> 9.99. Do NOT touch the spec.
cd fixture-app && npx playwright test > ../failures.txt 2>&1 ; cd ..
git diff -- spec fixture-app > change.patch
npm run sentinel -- classify --failures failures.txt --diff change.patch --propose
```

Expect `regression`, no criterion cited, no proposal, exit 1, and *"Fix the code."*

**2. An authorised change → `intentional_change`**

```bash
# restore the fee, then lower the threshold 500 -> 300 in BOTH
# spec/PRD.md (AC-7 and AC-8) and fixture-app/server.mjs
cd fixture-app && npx playwright test > ../failures.txt 2>&1 ; cd ..
git diff -- spec fixture-app > change.patch
npm run sentinel -- classify --failures failures.txt --diff change.patch --propose
```

Expect `intentional_change` citing AC-7, a proposed test diff carrying
`// Authorized by AC-7`, and *"NOT applied, awaiting human ratification."*

**3. Ratify** — approve in the dashboard, then show both decisions in the audit timeline.

**4. Deterministic** — add an illegal import, run `sentinel arch`. Fails with no LLM involved.

> **Scope the diff.** `git diff -- spec fixture-app` rather than a bare `git diff`. Unrelated
> changes elsewhere in the tree get sent to the model and can steer its reasoning — during
> rehearsal, in-flight edits to the classifier's own source came back paraphrased in the
> verdict. Send only the change under review.

> **Change AC-7 and AC-8 together.** Editing only one leaves the spec self-contradictory —
> "below 500 costs 4.99" alongside "300 or more ships free" — and the classifier reasons badly
> about a spec that disagrees with itself. Which is fair.

---

## Picking this up mid-build

> **Update:** the section below documents the handoff point when the dashboard still read mock
> data. That is no longer the case — `web/lib/data.ts` reads `.sentinel/audit.jsonl` and
> `spec/PRD.md` directly, Approve/Reject write real ratifications through
> `web/app/api/verdicts/[verdictId]/decision/route.ts`, and `web/scripts/seed-audit-log.mjs`
> drives the real `runClassify` pipeline (scripted model, no network) so `npx playwright test`
> has deterministic real content on a clean clone. Kept below as a record of where the build
> stood at that point.

**The backend and the demo fixture are done.** `sentinel classify` runs the whole pipeline end to
end, 101 tests pass, CI is green, both LLM providers respond, and **both demo paths have been
rehearsed against a live model** — a genuine bug comes back `regression`, a spec-authorised
change comes back `intentional_change` with a proposed test diff.

**What remained was the dashboard.** The product worked and could be demonstrated from a
terminal; what it could not yet do was let a human ratify anything through the UI.

| Blocker (resolved) | Owner | Why it mattered |
|---|---|---|
| Approve / Reject did nothing | C | The ratification gate is the product's entire argument. The demo had to stop at the terminal. |
| Dashboard showed mock data | C + D | Judges would see fixtures, not the real verdicts the CLI just produced. |
| Matrix and timeline were stubs | D | Both rendered; neither read real coverage or the real log. |

> **There is real data waiting for you.** Running the demo script writes genuine verdicts to
> `.sentinel/audit.jsonl`. Point the dashboard at that file and you have real content to build
> against — no need to invent any.

### If you are Person C

Own `/inbox` and `/inbox/[verdictId]`. The inbox is already built out — **copy it as your
pattern**. The diff viewer renders but its buttons are stubs; wiring them is the single highest
value frontend task in the repo.

Keep Approve and Reject visually identical. There is a comment in `web/app/globals.css`
explaining why — styling Approve as the default nudges reviewers into rubber-stamping, which is
the exact behaviour this product exists to prevent. It is not a bug.

### If you are Person D

Own `/matrix` and `/timeline`. Both render but are deliberately plain — build them out.

`fixture-app` is **already built** and both demo paths are rehearsed, so that is off your plate.
If you do touch it, keep it small — plain Node HTTP, no framework, no database. It is a stage
prop, and time spent polishing it buys nothing.

### Read first

[`WEB.md`](WEB.md) is the plan of record for the dashboard: per-view specs, a mockup of the diff
viewer, the ownership split, a ranked list of what to cut when time runs short, and the
`data-testid` hooks Playwright depends on.

Then [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, path ownership and the PR flow.

### Three things that will save you time

- **Build against mocks.** `web/lib/mock-data.ts` covers every state — a proposal with a diff, a
  regression with none, a low-confidence verdict. Do not wait on the backend.
- **`src/types.ts` is frozen.** It is the contract between backend and dashboard. Say so in the
  group chat before changing it.
- **Grep before you add a function.** Four PRs so far have added code beside code that already
  did the job — a duplicate LLM client, a duplicate spec parser, a second audit log, a
  traceability map that returned hardcoded paths. Each cost a cleanup PR.

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

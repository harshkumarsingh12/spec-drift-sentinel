# Spec Drift Sentinel — Project Brief

> Team brief for **Deploy or Die** — HowToAlgo x GDG on Campus KIIT, 8–9 Aug 2026.
> Track B (Developer Productivity Tools). Team of 4.
> Read this before writing any code.

---

## 1. One-line pitch

**Spec Drift Sentinel detects when code drifts from its specification, diagnoses whether the drift is an unintended regression or an intentional contract change, and — only for intentional changes — proposes updated Playwright tests for human approval, citing the acceptance criterion that authorises them.**

---

## 2. The problem

Developers change code and API contracts. E2E tests break. Two very different things can be happening, and today nothing tells you which:

- **A regression** — you broke something. The test is right, the code is wrong.
- **An intentional contract change** — the spec moved. The code is right, the test is stale.

Teams handle both the same way: someone manually rewrites the test until CI is green. That takes hours, and worse, it trains people to "fix" tests without asking which of the two situations they were in. Specs rot, tests decay into rubber stamps.

---

## 3. What we are explicitly NOT building

> **We do not auto-heal CI to green.**

An earlier framing of this idea was "automatically regenerate tests to restore a green pipeline." We rejected it, deliberately, for two reasons:

1. **It's an anti-pattern.** A test rewritten to match whatever the code now does is a tautology — it can never fail, because its definition of "correct" is "whatever the implementation currently outputs." That destroys the entire signal a test exists to provide.
2. **It violates a stated rule.** Slide 35 of the brief: *"Human in the loop is required. Blind, unreviewed auto-generation is not the point and will score poorly."*

Every proposed test change is ratified by a human. When no acceptance criterion authorises a change, **the test stays red by design.**

This is also our strongest Q&A answer — expect the panel to probe exactly here.

---

## 4. Why this idea wins

- **The Day 2 twist is our input.** The finalists' surprise requirement is, by definition, a spec change bolted onto an existing app. That is precisely what this tool consumes. At the panel we implement the twist, then run our own tool on our own change, live. No other team can eat the judges' curveball on stage.
- **It enforces the discipline the event is teaching.** The whole hackathon is spec-driven development (Spec Kit / BMAD). A tool that keeps code honest to its spec writes its own narrative.
- **It maps onto the scoring weights.** Spec & Architecture (25%) and Testing & Verification (15%) are the *subject matter* of the product, not just boxes we tick.

---

## 5. Architecture

Two analysis layers, split deliberately by determinism.

### Layer 1 — deterministic (no LLM)

Architecture rule enforcement. Rules declared in config, e.g. `ui/**` must not import from `db/**`. Pure static analysis over the import graph.

Cannot hallucinate. **Build this first** — it is the safety net if the agent layer runs late, and it gives us a rock-solid feature to demo beside the probabilistic one.

### Layer 2 — agent-driven

```
spec (PRD w/ AC-IDs) ──┐
                       ├──> traceability map (AC → code → tests)
codebase ──────────────┘
                              │
changed files (git diff) ─────┤
                              ▼
                    affected ACs identified
                              │
              Playwright run → failures
                              ▼
                  ┌───── CLASSIFIER AGENT ─────┐
                  │  regression?  or  intended │
                  │  contract change?          │
                  └────────────┬───────────────┘
            regression         │        intentional
                 │             │             │
        keep CI RED,           │      propose test diff
        explain broken         │      + cite authorising AC
        contract               │             │
                 │             │             ▼
                 └─────────────┴────> DASHBOARD (human ratifies)
                                              │
                                              ▼
                                        audit log (JSONL)
```

### The dashboard is a first-class component

The human approval gate is not a PR comment — it is a real web UI. Four views:

| View | What it does |
|---|---|
| **Drift inbox** | Pending verdicts awaiting human ratification |
| **Diff viewer** | Proposed test change side-by-side + the citing AC + approve/reject |
| **Traceability matrix** | AC → code → tests, colour-coded by status |
| **Audit timeline** | Every decision: verdict, reasoning, who ratified, when |

This also creates a satisfying loop: our product has a web UI → our Playwright tests cover it → our own tool analyses those tests.

### Audit log

Append-only JSONL, one row per decision:
`ac_id`, `verdict`, `reasoning`, `model`, `proposed_diff_hash`, `human_decision`, `timestamp`.

Keep it a log file. It is not a subsystem. Resist.

---

## 6. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript / Node.js** | Playwright is native here; trivial GitHub Actions support |
| Frontend | **Next.js + React** | Short hop from Compose — both declarative UI with state hoisting |
| E2E tests | **Playwright** | Explicitly rewarded in the brief's scored deliverables |
| CI | **GitHub Actions** | Gate requirement, and doubles as the product's own runtime |
| LLM primary | **NVIDIA Build** — `https://integrate.api.nvidia.com/v1` | Main coding/inference loop, ~1000 free credits |
| LLM fallback | **Groq** — `https://api.groq.com/openai/v1` | Switch on 429 rather than waiting it out |

**Every member generates their own API keys.** Free limits are per account — four accounts is four times the capacity.

### Repo layout

```
/spec/PRD.md               acceptance criteria with AC-IDs (AC-1, AC-2, …)
/src/
  /analyzers/
    architecture.ts        Layer 1 — deterministic dependency rules
    traceability.ts        AC → code → test map
  /agent/
    classifier.ts          Layer 2 — regression vs intentional
    proposer.ts            candidate Playwright test diffs
  /audit/log.ts            append-only JSONL
  cli.ts                   entry point
/web/                      Next.js dashboard (inbox, diff viewer, matrix, timeline)
/fixture-app/              deliberately tiny target app (3 endpoints + 1 screen)
/tests/                    our tests, incl. fixture diffs w/ known-correct verdicts
/action.yml                GitHub Action packaging
/.github/workflows/ci.yml
ARCHITECTURE.md            ── gate item 1
AGENTS.md                  ── gate item 2
AGENTS_AND_SKILLS.md       ── gate item 4
```

**On `fixture-app/`:** it exists to be broken on demand during the demo. Three endpoints, one screen, a handful of Playwright tests. **Do not let it grow into a second project.**

---

## 7. The five non-negotiables (entry gate)

Pass/fail. Miss one and we score **zero** — a brilliant app with a red pipeline never reaches a scorer. Get all five present and green in **hour one**, stubbed if necessary, then iterate.

| # | Item | Owner | Notes |
|---|---|---|---|
| 1 | `ARCHITECTURE.md` | D | Stack, data model, high-level design |
| 2 | `AGENTS.md` | D | Agent rules / constitution file |
| 3 | Working code | A + B | Builds and runs, demonstrable |
| 4 | 1 custom agent + 1 custom skill in `AGENTS_AND_SKILLS.md` | B | See below |
| 5 | Green GitHub Actions run | A | Must be the **most recent** run |

**Custom agent — `drift-classifier`:** renders the regression-vs-intentional verdict. Genuinely custom — bespoke system prompt, structured verdict schema, cites AC IDs. Not a generic assistant call.

**Custom skill — `propose-playwright-test`:** takes a failing test + the authorising AC, emits a candidate test diff.

Both must be **committed** *and* **documented** in `AGENTS_AND_SKILLS.md`.

---

## 8. Work split — 2 backend / 2 frontend

Parallel from hour one, minimal blocking.

**Person A — CI/CD + deterministic analyzer** *(backend)*
`ci.yml` green from the first commit. Playwright in CI with HTML report uploaded as an artifact. `action.yml` packaging. `architecture.ts` dependency rules.

**Person B — agent layer** *(backend)*
`classifier.ts`, `proposer.ts`, `traceability.ts`. Prompt design, structured output schema, NVIDIA→Groq fallback on 429. Owns `AGENTS_AND_SKILLS.md`.

**Person C — dashboard: inbox + diff viewer** *(frontend)*
The approval gate itself. Pending verdict list, side-by-side diff with the citing AC, approve/reject wired to the backend.

**Person D — dashboard: matrix + timeline, fixture app, docs** *(frontend)*
Traceability matrix, audit timeline, the tiny `fixture-app` and its Playwright tests, `ARCHITECTURE.md` + `AGENTS.md`.

**Contract between halves:** agree the JSON shape of a *verdict object* in the first 15 minutes and freeze it. Frontend builds against mock verdicts immediately; backend fills them in later. Nobody blocks.

---

## 9. Build order

**Setup — must be done before the 2PM build window.**
All four: GitHub + NVIDIA Build + Google AI Studio + Groq accounts, keys generated and saved. Install VS Code, Cline, Node LTS, Git, Docker, `uv`. Send one successful prompt through Cline. Create the public repo and confirm a trivial Actions workflow goes green.

| Phase | Goal |
|---|---|
| **Hour 1** | Repo scaffolded, all five gate items present (stubs fine), **CI green**, verdict JSON shape frozen |
| **Hour 2** | Fixture app + its Playwright tests in CI. Deterministic analyzer working. Dashboard shell rendering mock verdicts |
| **Hour 3** | Traceability map + classifier producing real verdicts. Inbox + diff viewer wired to real data |
| **Hour 4** | Proposer + approval flow + audit log end to end. Tag `v1.0.0` |
| **Final** | Record ~3 min demo video, confirm CI green + Playwright passing, submit repo link |

**Commit continuously.** A single end-of-day commit dump scores worse than a clean progressive history — this is stated explicitly in the brief.

**Scope discipline.** One spec format, one approval gate, one log file. With four people the temptation is a second analyzer or a settings page. Don't. The Day 2 twist punishes sprawl far more than it rewards extra features.

---

## 10. Demo script (the money run)

1. **Regression.** Break an endpoint's response shape in `fixture-app`. Run the tool.
   → CI stays **red**, verdict = `regression`, output names the broken contract. **No test is modified.**
2. **Intentional change.** Edit an AC in `spec/PRD.md` *and* the matching code. Run the tool.
   → verdict = `intentional_change`, a proposed test diff appears in the dashboard inbox citing the AC. **Not applied.**
3. **Ratify.** Approve in the dashboard → test updated → CI green. Show both decisions in the audit timeline with their reasoning.
4. **Deterministic.** Add an illegal import (`ui/` → `db/`). → deterministic failure, no LLM involved.

**Gate self-check before submitting:** five non-negotiables present · most recent Actions run green · Playwright report uploaded as artifact · at least one git tag · clean progressive commit history.

**Day 2 rehearsal:** practise implementing a new requirement and then running the tool on that very change. That is the finalist demo.

---

## 11. Panel Q&A prep

**Expect this, almost verbatim:**

> *"How do you distinguish a regression from an intentional contract change — and if you can't, why should I trust the replacement test?"*

**Answer:** We don't auto-trust anything. The spec is the arbiter. A test change is only ever *proposed* when an acceptance criterion authorises it, and it is never applied without human ratification. When there's no authorising AC, the test stays red by design — because a test rewritten to match the implementation is a tautology, not a test.

**Likely follow-ups:**

- *"What if the spec itself is wrong?"* → Then the test stays red and a human decides. We surface the conflict; we don't resolve it silently.
- *"What's your false-positive rate?"* → Point at `/tests/` — fixture diffs with known-correct verdicts, run in CI. Give the real number, don't hand-wave.
- *"Why two layers?"* → Determinism where determinism is possible. Architecture rules are graph analysis, not judgement; only the regression-vs-intent call genuinely needs a model.

# Architecture

Spec Drift Sentinel detects when code drifts from its specification, diagnoses whether the
drift is an unintended regression or an intentional contract change, and — only for
intentional changes — proposes an updated test for human ratification.

## Design principle

**Determinism where determinism is possible.** Only one question in this system genuinely
needs a language model: *did the spec authorise this behaviour change?* Everything else —
parsing criteria, walking the import graph, building the traceability map, recording
decisions — is ordinary computation and is implemented as such. This keeps the unreliable
surface small, auditable, and easy to reason about when it misbehaves.

The second principle follows from the first: **the system never makes a failing test pass.**
It can only propose, and a human decides. A test rewritten to match the implementation is a
tautology, not a test.

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 1 — deterministic (no LLM)                             │
│   src/analyzers/architecture.ts   import-graph rule checks   │
│   src/analyzers/traceability.ts   AC → code → test mapping   │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ Layer 2 — agent-driven                                       │
│   src/agent/classifier.ts   regression vs intentional change │
│   src/agent/proposer.ts     drafts a candidate test diff     │
│   src/agent/provider.ts     NVIDIA → Groq failover on 429    │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ Ratification and record                                      │
│   web/            dashboard: inbox, diff viewer, matrix      │
│   src/audit/log.ts append-only JSONL decision log            │
└──────────────────────────────────────────────────────────────┘
```

## Flow

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

## Data model

Defined in `src/types.ts`, which is the frozen contract between the analysis backend and the
dashboard. The frontend builds against mocks shaped like these while the backend is written.

| Type | Purpose |
|---|---|
| `AcceptanceCriterion` | An `AC-n` parsed from `spec/PRD.md`, with its prose and source line |
| `TestFailure` | A failing test normalised from the runner's report |
| `Verdict` | Classification outcome: kind, cited AC, confidence, reasoning, optional proposed diff |
| `AuditEntry` | One append-only row: verdict, cited AC, confidence, the failing test, model, diff hash, the full proposed diff, human decision, ratifier, timestamp |
| `DependencyRule` / `ArchitectureViolation` | Declared boundary and a concrete breach of it |
| `TraceabilityRow` | An AC with the code and tests claiming to cover it |

`VerdictKind` is `regression | intentional_change | unknown`. `unknown` is treated as
`regression` at every decision point — failing safe is the whole design.

### Why JSONL for the audit log

The log is append-only and read whole. A flat file gives us durability, trivial inspection
(`cat`, `grep`), and no schema migration during a two-hour build. It is a log, not a
subsystem, and should stay that way.

### Why `@covers AC-n` annotations

Linking spec to code by explicit annotation rather than inference keeps the mapping
greppable and honest. A criterion nothing claims is reported `orphaned` rather than being
silently matched to something that looks related.

## Safety properties

These are enforced in code and covered by tests, not merely intended:

1. A verdict of `intentional_change` citing an AC that does not exist is downgraded to
   `regression` (`normaliseVerdict`, `tests/classifier.test.ts`).
2. **A verdict of `intentional_change` is downgraded to `regression` when the diff does not
   touch the spec file** (`specWasChanged`, `tests/classify-command.test.ts`).
3. `propose()` throws if given anything other than an authorised `intentional_change`
   (`tests/proposer.test.ts`).
4. No code path writes a proposed diff to a test file. Application happens only after an
   explicit human decision.
5. Deterministic checks run with no API key configured (AC-6).

### Why property 2 exists

It was added after a live rehearsal, not designed up front. The shipping fee in the demo fixture
was changed from 4.99 to 9.99 with no accompanying spec change — an unambiguous regression — and
the classifier returned `intentional_change` citing AC-7, the very criterion that mandates 4.99.

The model had conflated a criterion that *governs* a behaviour with one that *authorises
changing* it. Property 1 cannot catch this, because the cited criterion genuinely exists.

The fix is deterministic rather than a stronger prompt: an intentional contract change means the
specification moved, and whether it moved is a fact about the diff. Only diff headers are
inspected, so a criterion quoted in a comment or a fixture does not count as the spec changing.

This is the clearest illustration of the design principle above. The model's judgement is
useful, but it is fenced in by checks that do not depend on judgement.

## Stack

### Where it all runs

`src/commands/classify.ts` is the seam that joins the layers: it reads the spec, calls the
classifier, conditionally calls the proposer, and appends to the audit log. The CLI is a thin
wrapper around it — argument parsing and provider construction only — so the pipeline can be
tested end to end with an injected completer and no network.

The command deliberately skips the proposer entirely for a regression rather than relying on
`propose()` to refuse. The refusal is still there as a hard guarantee, but making the intent
explicit at the call site means a reader does not have to trust a function two files away.

## Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript on Node 22+ | Playwright is native here; trivial GitHub Actions support |
| Tests | `node:test` | Built in — no runner dependency, fast CI |
| E2E | Playwright | Tests the dashboard; also the class of test the tool reasons about |
| Dashboard | Next.js + React | The ratification UI; short hop for Compose developers |
| LLM | NVIDIA Build → Groq failover | Free tiers; fall through on 429 rather than waiting |

## Exit codes

The CLI is a CI gate, so exit codes are part of the contract: `0` clean, `1` violations or
drift found, `2` bad usage or missing configuration.

## Deliberate non-goals

- No automatic merging, committing, or pushing.
- No editing the specification on the user's behalf.
- No behaviour that makes a failing test pass without a human decision.

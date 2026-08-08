# Web Dashboard — Plan

The ratification UI for Spec Drift Sentinel. This document is the plan of record for
Persons **C** and **D**. Read it before writing any component.

---

## 1. Why this exists

The backend can classify a failure and draft a replacement test. It deliberately cannot
*apply* one. A human has to look at the proposal, check it against the acceptance criterion
that supposedly authorises it, and say yes or no.

**This dashboard is that decision point.** It is not a reporting layer bolted on for looks —
without it the product is incomplete, because the whole premise is that a human ratifies.

Say this plainly if a judge asks why a CLI tool has a UI: *the approval gate needs a human,
and a human needs to see the diff next to the criterion that justifies it.*

## 2. The one screen that matters

If you build nothing else, build the **diff viewer**.

Showing the proposed test change *side by side with the acceptance criterion cited as
authorisation* is the entire idea made visible. The reviewer can **check the claim** rather
than trust it. Every other view is navigation around this one.

Design everything else to get here in as few clicks as possible.

## 3. The four views

### 3.1 Drift inbox — `/inbox` *(Person C)*

The landing surface. Every verdict awaiting a human decision.

Each row shows:

| Element | Notes |
|---|---|
| Verdict kind | `regression` or `intentional_change` — colour-coded, immediately distinguishable |
| Test name + file | What broke |
| Cited AC | `AC-2` badge, or a clear "no criterion" marker for regressions |
| Confidence | Only meaningful for `intentional_change`; surface low confidence visibly |
| Age | Relative time — "4 min ago" |

Rules:
- **Regressions are not actionable.** They carry no proposed diff and no approve button.
  Show them, explain the broken contract, make clear the fix is in the code not the test.
- **Only `intentional_change` rows link to the diff viewer.**
- Empty state matters — "No pending decisions" is a state judges will see. Make it
  deliberate, not a blank page.

### 3.2 Diff viewer — `/inbox/[verdictId]` *(Person C)*

Two panes, side by side:

```
┌─────────────────────────────┬─────────────────────────────┐
│ AUTHORISING CRITERION       │ PROPOSED TEST CHANGE        │
│                             │                             │
│ ### AC-2: Free shipping     │  - expect(fee).toBe(0)      │
│ threshold is 500            │  + expect(fee).toBe(4.99)   │
│                             │                             │
│ Orders of 500 or more ship  │                             │
│ free.                       │                             │
├─────────────────────────────┴─────────────────────────────┤
│ CLASSIFIER REASONING                                      │
│ AC-2 raised the threshold from 300 to 500, so the test's  │
│ assertion at 400 is stale.                                │
├───────────────────────────────────────────────────────────┤
│           [ Approve ]         [ Reject ]                  │
└───────────────────────────────────────────────────────────┘
```

Requirements:
- Diff rendered with **added and removed lines visually distinct** — green/red backgrounds,
  not just `+`/`-` characters.
- The criterion pane shows the **full text**, not a truncated title. The reviewer is
  verifying a claim; they need the evidence.
- Approve and Reject are **equally weighted**. Do not style Approve as the obvious default —
  that nudges people into rubber-stamping, which is the behaviour this product exists to stop.
- After a decision, redirect to the inbox with the row resolved.

### 3.3 Traceability matrix — `/matrix` *(Person D)*

Every acceptance criterion and what covers it.

| Column | Content |
|---|---|
| AC id | `AC-1` |
| Title | From the PRD heading |
| Status | `covered` / `untested` / `orphaned` |
| Code | Files with a `@covers` annotation |
| Tests | Test files claiming it |

Colour: covered = green, untested = amber, orphaned = red. This is the view that makes spec
rot visible at a glance, so the colour coding is the point — get it right.

### 3.4 Audit timeline — `/timeline` *(Person D)*

Every decision in chronological order, newest first. Read-only.

Each entry: timestamp · verdict kind · cited AC · human decision · who decided · reasoning.

This is your traceability story for the panel — a judge should be able to scroll it and
reconstruct exactly what happened and who signed off on each change. Make it skimmable.

## 4. Data contract

**`src/types.ts` is the source of truth.** `web/lib/types.ts` mirrors it.

> ⚠️ **Known trade-off.** The types are currently duplicated because `web/` is a separate
> npm package and cannot import across the boundary cleanly. If you change `src/types.ts`,
> change `web/lib/types.ts` in the same commit. The proper fix is npm workspaces — worth
> doing if we have spare time, not worth doing under pressure.

Types you will use: `Verdict`, `AuditEntry`, `TraceabilityRow`, `AcceptanceCriterion`.

### Build against mocks first *(historical — done, mocks removed)*

This section originally pointed at `web/lib/mock-data.ts` as realistic fixtures to build
every view against before the backend was ready. That file no longer exists — see below.

### Wiring to real data — done

Every view now reads real data via `web/lib/data.ts` (option 1 below, as recommended): it
reads `.sentinel/audit.jsonl` and `spec/PRD.md` directly in server components, no API layer
needed for reads. Approve/Reject go through a route handler
(`web/app/api/verdicts/[verdictId]/decision/route.ts`) since they need to *write*.

For realistic content on a clean clone (a low-confidence verdict, a mix of pending/approved/
rejected) without depending on network or API keys, `web/scripts/seed-audit-log.mjs` drives
the actual `runClassify` pipeline with a scripted model response — the same determinism
trick `tests/classify-command.test.ts` uses. Playwright's `webServer` runs it automatically;
run it by hand with `npm run seed` (from `web/`).

## 5. Routes

```
/                      overview — counts, links into the four views
/inbox                 drift inbox                        (C)
/inbox/[verdictId]     diff viewer + approve / reject     (C)
/matrix                traceability matrix                (D)
/timeline              audit timeline                     (D)
```

## 6. Stack and conventions

- **Next.js App Router**, TypeScript, React server components by default.
- `'use client'` only where you need interactivity — the approve/reject buttons, essentially.
- **Plain CSS with variables** in `app/globals.css`. No Tailwind: the config cost is not worth
  it for four screens, and a missing build step at 3pm is a bad way to lose.
- Design tokens are already defined — `--bg`, `--panel`, `--text`, `--muted`, `--ok`,
  `--warn`, `--danger`, `--border`. Use them rather than hard-coded hex, so the four views
  look like one product.
- ~~Dark theme. It is a developer tool and it demos better in a dim room.~~ **Superseded.**
  The dashboard shipped with a light, card-based theme instead — a deliberate later call,
  not a reversion to this. See `app/globals.css`'s design-token comments.

## 7. Getting started

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run test:e2e   # 18 Playwright specs — keep these green
```

**Update — all four views are done and read real data.** `web/lib/data.ts` reads
`.sentinel/audit.jsonl` and `spec/PRD.md` directly; there is no `mock-data.ts` any more. The
table below is kept as a record of the build sequence, not current status.

### Original build sequence (historical)

| Route | State at handoff | Owner |
|---|---|---|
| `/` | Done — overview with live counts | — |
| `/inbox` | Done — used as the reference pattern | C |
| `/inbox/[verdictId]` | Rendered; Approve / Reject were stubs | C |
| `/matrix` | Working stub, deliberately plain | D |
| `/timeline` | Working stub, deliberately plain | D |

**18 Playwright specs already run against these views.** They assert real behaviour — that a
regression offers no approve button, that the criterion is quoted in full, that Approve and
Reject have equal width. Keep them green; if you change markup, update the specs rather than
deleting the assertion.

## 8. Division of work

| | Person C | Person D |
|---|---|---|
| Owns | `/inbox`, `/inbox/[verdictId]` | `/matrix`, `/timeline` |
| Priority | **Wire Approve / Reject** — nothing else comes close | Matrix first — it is the most visual |
| Shared | `app/globals.css`, `lib/` — coordinate before editing |

Agree who touches `globals.css` before you both do. It is the one file you will conflict on.

`fixture-app` is **built and both demo paths are rehearsed** — §8.1 below is kept as reference
for how it works, not as work outstanding.

### 8.1 `fixture-app` — reference, already built

A deliberately tiny cart API whose tests can be made to fail on demand. It exists because our
product diagnoses failing tests, so we need something whose tests can fail.

```
fixture-app/
  server.mjs            3 endpoints, plain Node http, zero deps
  public/index.html     1 screen
  e2e/fixture.spec.ts   7 Playwright specs
```

Runs on **port 3100**, so it does not clash with the dashboard on 3000.

Everything hangs off one rule stated in the spec — the free-shipping threshold, `AC-8`:

```js
const FREE_SHIPPING_THRESHOLD = 500;   // AC-8 — the value changed live on stage
const STANDARD_SHIPPING_FEE = 4.99;    // AC-7
```

Breaking the fee gives you the regression path. Changing the threshold in **both**
`spec/PRD.md` and `server.mjs` gives you the authorised path. One rule, both demo paths.

**Two things learned rehearsing it**, both now in the README demo script:

- **Scope the diff** — `git diff -- spec fixture-app`, not a bare `git diff`. Unrelated changes
  elsewhere get sent to the model and can steer its reasoning.
- **Change AC-7 and AC-8 together.** Editing one leaves the spec contradicting itself, and the
  classifier reasons badly about a spec that disagrees with itself.

## 9. Definition of done, per view

- [x] Renders correctly from real data (`web/lib/data.ts`) with no console errors
- [x] Handles the empty state deliberately
- [x] Handles the absent case — no proposed diff, no cited AC, no test files
- [x] Uses design tokens, not hard-coded colours
- [x] Readable at 1280px wide — that is the projector, not your laptop
- [x] Has a `data-testid` on the elements Playwright will need

## 10. Playwright hooks

Person A wires the tests, but **you** add the hooks. Put `data-testid` on:

| Testid | Where |
|---|---|
| `verdict-row` | Each inbox row |
| `verdict-kind` | The regression / intentional badge |
| `approve-button` / `reject-button` | Diff viewer actions |
| `criterion-text` | The AC pane |
| `proposed-diff` | The diff pane |
| `matrix-row` | Each matrix row |
| `timeline-entry` | Each timeline entry |

Add these as you build. Retrofitting them later is how the Playwright deliverable gets
dropped, and it is worth 15% of the score.

## 11. What "perfect" means here

Ranked, so you know what to cut when time runs short:

1. **The diff viewer works and reads clearly.** Everything else is optional next to this.
2. **Approve and Reject both work** and write to the audit log.
3. **Nothing looks broken.** One polished view beats four half-finished ones. If you run out
   of time, cut a view rather than shipping something visibly unfinished.
4. **It runs from a clean clone** with `npm install && npm run dev`. A judge will try this.
5. **Empty and error states are deliberate.** Judges click things that have no data.

## 12. Deliberate non-goals

- No authentication. It is a local developer tool.
- No database. The audit log is a file, and that is a feature — you can `cat` it on stage.
- No mobile layout. Nobody reviews a code diff on a phone.
- No dark/light toggle. One theme, ship it — the shipped theme is light, not the dark one
  originally planned here (`app/globals.css`), but the "pick one, don't build a toggle"
  reasoning still holds.

# Spec Drift Sentinel — Product Requirements

Acceptance criteria are the contract this project is judged against, by its own tooling.
Each is declared as a `### AC-n: Title` heading. Code and tests claim coverage with a
`@covers AC-n` annotation; run `npm run sentinel -- trace` to see the current mapping.

**Changing an acceptance criterion is how you authorise a behaviour change.** Nothing else
authorises one. If the code moves and no AC moved with it, the Sentinel calls it a regression.

---

## Problem

When an end-to-end test fails, two very different things may have happened:

- The code broke a contract the spec still asserts — a **regression**.
- The spec moved and the test is now stale — an **intentional contract change**.

Teams treat both the same way: rewrite the test until CI is green. That trains people to
silence tests without asking which situation they were in, and specs rot into fiction.

## Users

Developers and reviewers on a team that practises spec-driven development and runs
end-to-end tests in CI.

---

## Acceptance criteria

### AC-1: A failure with no authorising criterion is a regression

When a test fails and no acceptance criterion authorises the new behaviour, the system must
classify the failure as `regression`, leave the test unmodified, and exit non-zero so CI
stays red. Absence of a criterion forbidding the behaviour is not authorisation. An
uncertain classification must fall back to `regression`.

A criterion that merely *governs* the behaviour is not one that *authorises changing* it.
Accordingly, if the change under review does not modify the specification file, the system
must treat the failure as a regression regardless of which criterion was cited. An intentional
contract change means the specification moved, and whether it moved is a fact about the diff
rather than a judgement the classifier is permitted to make.

### AC-2: A test update may only be proposed, never applied

The system may draft an updated test only when a failure has been classified as
`intentional_change` and cites an acceptance criterion that exists in the spec. The draft
must be presented as a diff for human review and must never be written to disk, committed,
or applied automatically. A verdict citing an unknown or absent criterion must be downgraded
to `regression`.

### AC-3: Architecture rules are enforced deterministically

Declared dependency rules must be checked by static analysis of the import graph, with no
language model involved. A violation must report the offending file, the line number, the
import specifier, and the rule it breaks. This check must run and pass or fail identically
without any API key configured.

### AC-4: Every decision is recorded in an append-only log

Each classification and each human ratification must append one row to the decision log,
recording the verdict, the cited criterion, the confidence score, the failing test, the model
that produced it, a hash of any proposed diff, the full proposed diff text, the human decision,
and a timestamp. Rows are never edited or deleted, so the full history of a verdict can be
reconstructed — including, for a dashboard reading the log directly, the reasoning and diff a
human reviewer needs to ratify it (AC-5).

### AC-5: A human ratifies every proposed change

A proposed test update must remain in a pending state until a human explicitly approves or
rejects it. The dashboard must show the proposed diff alongside the acceptance criterion
cited as authorisation, so the reviewer can check the claim rather than trust it. The
ratifying identity is recorded in the audit log.

### AC-6: The tool reports drift without an LLM available

With no provider key configured, the deterministic checks (`arch`, `trace`, `audit`, `diff`)
must still run and report correctly. Only classification and proposal require a provider, and
their absence must produce a clear message naming the environment variables to set.

---

## Fixture application

The criteria below govern `fixture-app/`, a deliberately tiny demo fixture — **not Spec Drift
Sentinel itself**. They exist so the tool has a real specification to reason about, and a real
application whose tests can be made to fail on demand.

They live here rather than in a second spec file so the whole pipeline works with no extra
flags: the CLI reads this file, writes to the root audit log, and the dashboard reads that same
log.

### AC-7: Orders below the free-shipping threshold are charged a flat fee

An order with a subtotal below 500 is charged a shipping fee of 4.99. The cart API must return
the subtotal, the shipping fee, and the total including that fee.

### AC-8: Orders at or above the threshold ship free

An order with a subtotal of 500 or more is charged a shipping fee of 0.00. The threshold is
inclusive: a subtotal of exactly 500 ships free.

### AC-9: The cart screen shows monetary values to two decimal places

The cart screen must display the subtotal, shipping fee and total formatted to exactly two
decimal places, so a zero fee reads `0.00` rather than `0`.

---

## Out of scope

- Automatically merging, committing, or pushing anything.
- Editing the specification on the user's behalf.
- Any behaviour that makes a failing test pass without a human decision.

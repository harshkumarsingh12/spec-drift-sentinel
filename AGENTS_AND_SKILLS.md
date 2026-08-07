# Custom agents and skills

Two purpose-built components, both committed to this repo. Neither is a generic assistant
call: each has a bespoke system prompt, a constrained output schema, and validation that
overrides the model when it strays.

---

## Agent: `drift-classifier`

**Source:** `src/agent/classifier.ts`
**Prompt:** `SYSTEM_PROMPT` in that file

### What it does

Given a failing test, the acceptance criteria in scope, and the code diff, it decides between
exactly two outcomes:

| Verdict | Meaning | Consequence |
|---|---|---|
| `regression` | The code broke a contract the spec still asserts | CI stays red, no test is touched |
| `intentional_change` | A specific AC authorises the new behaviour | A test update may be *proposed* |

### Why it is custom

- **Citation is mandatory.** To return `intentional_change` the model must name the exact
  `AC-n` that authorises it.
- **The citation is verified in code, not trusted.** `normaliseVerdict()` checks the cited id
  against the criteria actually parsed from `spec/PRD.md`. A hallucinated or absent citation is
  downgraded to `regression`. The model cannot argue its way past this.
- **It fails safe.** Malformed output, an unrecognised verdict kind, or genuine uncertainty all
  resolve to `regression`.
- **Structured output.** A single JSON object, tolerant of fenced or prose-padded replies.

### Guarantees under test

`tests/classifier.test.ts` — hallucinated AC ids, missing citations, unrecognised kinds and
empty responses all resolve to `regression`; no diff is ever attached at classification time.

---

## Skill: `propose-playwright-test`

**Source:** `src/agent/proposer.ts`
**Prompt:** `SYSTEM_PROMPT` in that file

### What it does

Drafts an updated test for a failure already classified as an authorised intentional change,
returning a unified diff plus an explanation naming the part of the criterion that requires it.

### Why it is custom

- **It is unreachable for regressions.** `propose()` throws unless the verdict is
  `intentional_change` *and* its cited AC matches the criterion supplied. This is a hard gate
  in code, not a prompt instruction.
- **It encodes intent, not observed output.** The prompt directs the model to assert what the
  criterion says, explicitly not what the implementation currently returns — the difference
  between a test and a tautology.
- **It cannot weaken a test.** Deleting assertions, loosening matchers, `.skip` and inflated
  timeouts are all prohibited.
- **It may refuse.** If the criterion does not actually describe the observed behaviour, it
  returns an empty diff and says so instead of inventing an assertion.
- **It never writes.** Output is a proposal. Application requires a human decision recorded in
  the audit log.

### Guarantees under test

`tests/proposer.test.ts` — refuses regressions, refuses mismatched citations, does not mutate
the verdict it is given, and treats an empty diff as "no honest update possible".

---

## Provider layer

**Source:** `src/agent/provider.ts`

Both components take a `CompleteFn`, so tests inject a stub and never touch the network. In
production the completer tries NVIDIA Build first and falls through to Groq on `429` or `5xx`.
A malformed-request error is not retried — it would fail identically elsewhere.

With no key configured the deterministic commands (`arch`, `trace`, `audit`) still run
normally; only classification and proposal require a provider.

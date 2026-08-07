# Spec Drift Sentinel

Keeps code honest to its specification.

When an end-to-end test fails, two very different things may have happened: the code broke a
contract the spec still asserts (**a regression**), or the spec moved and the test is now
stale (**an intentional contract change**). Nothing in a normal CI run tells you which.

Spec Drift Sentinel makes that call explicitly. It reads the acceptance criteria, examines the
change, and classifies the failure. For a regression it keeps CI red and names the broken
contract. For a change an acceptance criterion actually authorises, it drafts an updated test
and presents it as a diff for a human to approve — citing the criterion that permits it.

Every decision, automated or human, is recorded in an append-only audit log.

Built for **Deploy or Die** — HowToAlgo x GDG on Campus KIIT, Track B.

## Quick start

```bash
npm install
npm test

npm run sentinel -- arch     # deterministic dependency rules — no API key needed
npm run sentinel -- trace    # acceptance criterion → code → test matrix
npm run sentinel -- audit    # the decision log
```

For classification and proposals, copy `.env.example` to `.env` and add a provider key.

## How it works

Two layers, split deliberately by determinism:

- **Layer 1 — deterministic.** Architecture rules and the traceability map. Pure static
  analysis of the import graph and the spec; cannot hallucinate; runs without any API key.
- **Layer 2 — agent-driven.** `drift-classifier` decides regression vs intentional change;
  `propose-playwright-test` drafts a candidate diff. Both are documented in
  [`AGENTS_AND_SKILLS.md`](AGENTS_AND_SKILLS.md).

A test update is only ever *proposed*. Nothing is applied without an explicit human decision,
and a verdict that cannot cite a real acceptance criterion is treated as a regression.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design and [`spec/PRD.md`](spec/PRD.md)
for the acceptance criteria this project is judged against — by its own tooling.

## Repository

| Path | Contents |
|---|---|
| `src/analyzers/` | Deterministic layer: import-graph rules, traceability |
| `src/agent/` | Classifier, proposer, provider failover |
| `src/audit/` | Append-only decision log |
| `spec/PRD.md` | Acceptance criteria (`AC-n`) |
| `tests/` | Unit tests, including the safety guarantees |

## Documents

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, who owns what, branching, definition of done
- [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) — team brief: plan, work split, demo script
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — design and data model
- [`AGENTS.md`](AGENTS.md) — rules for AI agents working in this repo
- [`AGENTS_AND_SKILLS.md`](AGENTS_AND_SKILLS.md) — the custom agent and skill

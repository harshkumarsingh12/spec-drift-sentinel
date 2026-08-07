# Contributing

Four people, one afternoon, one repo. This document exists so nobody blocks anybody and
nobody's work gets clobbered. Read it once before your first commit.

## Setup

```bash
git clone https://github.com/harshkumarsingh12/spec-drift-sentinel.git
cd spec-drift-sentinel
npm install              # also creates .env for you from the template
npm test                 # should be green before you change anything

# paste your own keys into .env, then:
npm run check:providers  # confirms both providers actually respond
```

**Node 22 or newer is required** — `node --test` needs glob support that Node 20 lacks.
Check with `node --version`.

**Generate your own API keys.** Free-tier limits are per account, so four members with four
keys is four times the capacity. Never commit `.env`, and never paste a key into a chat with
an AI tool.

## Who owns what

Work is split so two people can be in the backend and two in the frontend without touching
the same files. Stay inside your area; if you need a change outside it, ask the owner rather
than editing it yourself.

| Area | Paths | Owner |
|---|---|---|
| CI/CD + deterministic analyzer | `.github/`, `src/analyzers/architecture.ts` | A |
| Agent layer | `src/agent/`, `AGENTS_AND_SKILLS.md` | B |
| Dashboard — inbox + diff viewer | `web/` (inbox, diff routes) | C |
| Dashboard — matrix + timeline, fixture app | `web/` (matrix, timeline), `fixture-app/` | D |
| Spec + docs | `spec/`, `ARCHITECTURE.md` | D |

`src/types.ts` is **shared and frozen**. It is the contract between the backend and the
dashboard. Changing it means telling everyone in the group chat first — a silent change there
breaks the other half of the team.

## The frozen contract

The frontend does not wait for the backend. `src/types.ts` defines `Verdict`, `AuditEntry`,
`TraceabilityRow` and friends. Build against hand-written mock objects shaped like those, and
swap in real data when the backend lands. Neither half blocks the other.

## Branching and pull requests

```bash
git switch -c feat/drift-inbox      # feat/ fix/ docs/ chore/ test/ refactor/
# ... work, committing as you go ...
git push -u origin feat/drift-inbox
gh pr create --fill
```

- **Never push directly to `main`.** Even a one-line fix goes through a PR.
- Keep PRs small — one concern each. A PR that touches four areas is four PRs.
- CI must be green before merge. A red pipeline on `main` is a scored failure for the whole
  team, not just for you.
- Anyone on the team can approve. Don't wait on a specific person; ping the group chat.
- Rebase on `main` before merging if your branch has drifted: `git pull --rebase origin main`.

## Commits

Conventional commits, imperative mood:

```
feat: add diff viewer to the drift inbox
fix: downgrade verdicts citing unknown criteria
docs: explain the frozen type contract
test: cover the proposer refusal path
chore: bump CI to Node 22
```

**Commit continuously.** A clean progressive history is explicitly scored; a single
end-of-day dump scores badly. Commit every time something works, not when everything works.

## Definition of done

Before you open a PR:

- [ ] `npm test` passes locally
- [ ] `npm run lint` is clean
- [ ] `npm run typecheck` is clean
- [ ] `npm run sentinel -- arch` passes (you haven't crossed an architecture boundary)
- [ ] New behaviour has a test
- [ ] If behaviour changed, `spec/PRD.md` changed too — the spec is the arbiter
- [ ] Anything implementing a criterion carries a `@covers AC-n` comment
- [ ] No secrets, no `.env`, no `dist/`, no `node_modules/`

## Pre-commit hook

`npm install` wires up a hook that runs ESLint and scans staged files for anything that looks
like a live API key. It's fast — a few seconds.

If it blocks you and you're certain it's wrong, `git commit --no-verify` skips it. Use that
sparingly: CI runs the same lint, so you've only deferred the failure.

## House rules

These come from `AGENTS.md` and apply to humans just as much as to agents:

1. **Never make a failing test pass by weakening it.** No deleted assertions, no loosened
   matchers, no `.skip`, no inflated timeouts. If a test is wrong, say so in the PR.
2. **Never auto-apply a proposed test change.** The whole premise of this project is that a
   human ratifies. Propose; don't apply.
3. **Deterministic beats probabilistic.** If a check can be static analysis, it must be.
4. **When uncertain, fail safe** — classify as `regression`, keep CI red, surface the question.

## Conventions

- TypeScript, ESM, `strict`. Relative imports carry a `.js` extension (NodeNext resolution) —
  `import { x } from './thing.js'` even though the file is `thing.ts`.
- Tests use the built-in `node:test` runner. No test framework dependency.
- Exit codes are a contract: `0` clean, `1` drift or violations, `2` bad usage.
- Run `npm run sentinel -- trace` to see which acceptance criteria are still uncovered.

## When you're stuck

Say so in the group chat within ten minutes. Mentors are on site all day. An hour lost to
silent debugging is an hour the team doesn't get back — and the build window is short.

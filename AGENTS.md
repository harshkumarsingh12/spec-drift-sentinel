# Agent rules

Constitution for any AI coding agent working in this repository. These rules exist to keep
the agent effective as the project grows, and to keep context and quota spend under control.

## Non-negotiable

1. **Never make a failing test pass by weakening it.** No deleted assertions, no loosened
   matchers, no `.skip`, no inflated timeouts, no `try/catch` swallowing a failure. If a test
   is wrong, say so and stop.
2. **Never apply a proposed test change.** This project's entire premise is that a human
   ratifies. Propose diffs; do not write them to test files.
3. **Never commit secrets.** API keys live in `.env`, which is gitignored. `.env.example`
   holds names only.
4. **The spec is the arbiter.** Behaviour changes require a matching change in
   `spec/PRD.md`. Do not change behaviour and leave the spec behind.

## Working style

- Read before writing. Reuse what exists — check `src/types.ts` before inventing a shape.
- Small, reviewable steps. Commit continuously; do not batch a day's work into one commit.
- Deterministic beats probabilistic. If a check can be static analysis, it must be.
- When uncertain, fail safe: classify as `regression`, keep CI red, surface the question.

## Conventions

- TypeScript, ESM, `strict` on. Relative imports carry a `.js` extension (NodeNext).
- Tests use the built-in `node:test` runner. No test framework dependency.
- Every acceptance criterion is claimed with a `@covers AC-n` comment in the code or test
  that implements it.
- Conventional commit messages: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.
- Exit codes are a contract: `0` clean, `1` drift or violations, `2` bad usage.

## Provider discipline

Free tiers rate-limit hard. Split work by provider: planning and hard reasoning on Gemini,
the bulk implementation loop on NVIDIA Build, fast small edits on Groq. On a 429, fail over
rather than waiting it out. Keep these rules tight so conventions are not re-sent every task —
that is context management and quota management at once.

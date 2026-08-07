## What changed

<!-- One or two sentences. If this implements an acceptance criterion, name it: AC-n. -->

## Why

<!-- What problem this solves. Link an issue if there is one. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run typecheck` is clean
- [ ] `npm run sentinel -- arch` passes
- [ ] New behaviour has a test
- [ ] `spec/PRD.md` updated if behaviour changed
- [ ] `@covers AC-n` added to anything implementing a criterion
- [ ] No secrets, no `.env`, no build output

## House rules

- [ ] No test was weakened to make CI pass (no deleted assertions, loosened matchers,
      `.skip`, or inflated timeouts)
- [ ] Nothing auto-applies a proposed test change

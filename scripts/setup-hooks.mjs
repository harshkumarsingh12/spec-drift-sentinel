/**
 * Points git at the tracked .githooks directory.
 *
 * Runs automatically after `npm install`, so every teammate gets the pre-commit
 * hook without a manual step. Hooks live in the repo rather than .git/hooks so
 * they are version-controlled and shared.
 *
 * No husky dependency — core.hooksPath does the same job in one line.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.git')) {
  // A tarball or a vendored copy, not a clone. Nothing to configure.
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'pipe' });
  console.log('[hooks] Pre-commit hook enabled (lint + secret scan).');
} catch (error) {
  // Never fail an install over this — the same checks run in CI regardless.
  console.log(`[hooks] Could not configure git hooks: ${error.message}`);
}

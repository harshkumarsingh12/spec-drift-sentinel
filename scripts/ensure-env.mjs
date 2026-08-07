/**
 * Creates .env from .env.example if it doesn't already exist.
 *
 * Runs automatically after `npm install`, so nobody has to create the file by
 * hand on a fresh clone. Existing files are never touched — your keys are safe.
 *
 * .env itself stays gitignored on purpose: the moment it is tracked, someone
 * commits a real key.
 */

import { copyFileSync, existsSync } from 'node:fs';

const EXAMPLE = '.env.example';
const TARGET = '.env';

if (existsSync(TARGET)) {
  process.exit(0);
}

if (!existsSync(EXAMPLE)) {
  console.log(`[env] ${EXAMPLE} is missing — skipping.`);
  process.exit(0);
}

copyFileSync(EXAMPLE, TARGET);
console.log(`[env] Created ${TARGET} from ${EXAMPLE}. Add your own API keys to it.`);
console.log('[env] Then run: npm run check:providers');

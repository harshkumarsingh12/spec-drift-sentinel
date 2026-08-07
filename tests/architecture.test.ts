import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkArchitecture,
  extractImports,
  matchesGlob,
  resolveImport,
} from '../src/analyzers/architecture.js';
import type { DependencyRule } from '../src/types.js';

/** @covers AC-3 */

describe('matchesGlob', () => {
  test('** spans path separators', () => {
    assert.equal(matchesGlob('src/web/a/b/c.ts', 'src/web/**'), true);
  });

  test('* does not span path separators', () => {
    assert.equal(matchesGlob('src/web/a/b.ts', 'src/web/*'), false);
    assert.equal(matchesGlob('src/web/b.ts', 'src/web/*'), true);
  });

  test('does not match a sibling directory with a shared prefix', () => {
    assert.equal(matchesGlob('src/website/a.ts', 'src/web/**'), false);
  });

  test('treats dots literally', () => {
    assert.equal(matchesGlob('srcXweb/a.ts', 'src.web/**'), false);
  });
});

describe('extractImports', () => {
  test('finds static, side-effect, re-export, require and dynamic imports', () => {
    const source = [
      `import { a } from './a.js';`,
      `import './side-effect.js';`,
      `export { b } from './b.js';`,
      `const c = require('./c.js');`,
      `const d = await import('./d.js');`,
    ].join('\n');

    const specifiers = extractImports(source).map((ref) => ref.specifier);
    assert.deepEqual(specifiers, [
      './a.js',
      './side-effect.js',
      './b.js',
      './c.js',
      './d.js',
    ]);
  });

  test('reports 1-indexed line numbers', () => {
    const refs = extractImports(`// header\nimport { a } from './a.js';`);
    assert.equal(refs[0]?.line, 2);
  });
});

describe('resolveImport', () => {
  test('ignores bare package specifiers', () => {
    assert.equal(resolveImport('src/web/page.ts', 'react', '/repo'), null);
  });

  test('maps a NodeNext .js specifier back to its .ts source', () => {
    assert.equal(
      resolveImport('src/web/page.ts', '../db/client.js', '/repo'),
      'src/db/client.ts',
    );
  });
});

describe('checkArchitecture', () => {
  function scaffold(): string {
    const root = mkdtempSync(join(tmpdir(), 'sentinel-arch-'));
    mkdirSync(join(root, 'src', 'web'), { recursive: true });
    mkdirSync(join(root, 'src', 'db'), { recursive: true });
    writeFileSync(join(root, 'src', 'db', 'client.ts'), 'export const db = 1;\n');
    return root;
  }

  const rules: DependencyRule[] = [
    { from: 'src/web/**', forbid: 'src/db/**', reason: 'the web layer must go through services' },
  ];

  test('reports a forbidden edge with its line number', () => {
    const root = scaffold();
    writeFileSync(
      join(root, 'src', 'web', 'page.ts'),
      `// a comment\nimport { db } from '../db/client.js';\nexport const page = db;\n`,
    );

    const violations = checkArchitecture(root, rules);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.file, 'src/web/page.ts');
    assert.equal(violations[0]?.line, 2);
    assert.equal(violations[0]?.resolved, 'src/db/client.ts');
  });

  test('passes when the boundary is respected', () => {
    const root = scaffold();
    writeFileSync(join(root, 'src', 'web', 'page.ts'), `export const page = 1;\n`);
    assert.deepEqual(checkArchitecture(root, rules), []);
  });

  test('does not flag imports made from outside the governed directory', () => {
    const root = scaffold();
    mkdirSync(join(root, 'src', 'services'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'services', 'orders.ts'),
      `import { db } from '../db/client.js';\nexport const orders = db;\n`,
    );
    assert.deepEqual(checkArchitecture(root, rules), []);
  });
});

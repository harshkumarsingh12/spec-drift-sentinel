import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  affectedCriteria,
  buildTraceability,
  changedFilesFromDiff,
  coveredIds,
  extractComments,
  parseAcceptanceCriteria,
  parseAcceptanceCriteriaFromText,
} from '../src/analyzers/traceability.js';

/** @covers AC-3 */

function writeSpec(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sentinel-trace-'));
  const path = join(dir, 'PRD.md');
  writeFileSync(path, contents);
  return path;
}

describe('parseAcceptanceCriteria', () => {
  test('parses id, title and body', () => {
    const path = writeSpec(
      ['# PRD', '', '### AC-1: Users can log in', 'The system must accept valid credentials.', ''].join(
        '\n',
      ),
    );
    const [ac] = parseAcceptanceCriteria(path);
    assert.equal(ac?.id, 'AC-1');
    assert.equal(ac?.title, 'Users can log in');
    assert.equal(ac?.text, 'The system must accept valid credentials.');
  });

  test('stops the body at the next heading', () => {
    const path = writeSpec(
      ['### AC-1: First', 'body one', '', '### AC-2: Second', 'body two'].join('\n'),
    );
    const criteria = parseAcceptanceCriteria(path);
    assert.equal(criteria.length, 2);
    assert.equal(criteria[0]?.text, 'body one');
    assert.equal(criteria[1]?.text, 'body two');
  });

  test('returns nothing when the spec declares no criteria', () => {
    assert.deepEqual(parseAcceptanceCriteria(writeSpec('# PRD\n\nSome prose.\n')), []);
  });

  test('parses bullet-form acceptance criteria without creating a second parser', () => {
    const criteria = parseAcceptanceCriteriaFromText(
      ['# PRD', '', '- AC-1: Users can log in', '- AC-2: Users can log out'].join('\n'),
      'spec/PRD.md',
    );

    assert.equal(criteria.length, 2);
    assert.equal(criteria[0]?.id, 'AC-1');
    assert.equal(criteria[0]?.text, 'Users can log in');
    assert.equal(criteria[1]?.id, 'AC-2');
    assert.equal(criteria[1]?.text, 'Users can log out');
  });
});

describe('extractComments', () => {
  test('keeps line and block comment text, including JSDoc', () => {
    const source = ['// a line comment', '/** a jsdoc comment */', '/* a block comment */'].join(
      '\n',
    );
    const out = extractComments(source);
    assert.match(out, /a line comment/);
    assert.match(out, /a jsdoc comment/);
    assert.match(out, /a block comment/);
  });

  test('drops the contents of string and template literals', () => {
    const source = [
      "const a = 'single quoted';",
      'const b = "double quoted";',
      'const c = `template ${x} literal`;',
    ].join('\n');
    const out = extractComments(source);
    assert.doesNotMatch(out, /single quoted/);
    assert.doesNotMatch(out, /double quoted/);
    assert.doesNotMatch(out, /template/);
  });

  test('does not let an escaped quote end a string early', () => {
    // If backslash escapes inside strings are not honoured, this reads as the
    // string ending right after \', leaving the real trailing comment
    // swallowed into a bogus, unterminated "string" starting at the next
    // quote character — so its @covers annotation would go undetected.
    const source = String.raw`const s = 'it\'s a trap'; // real comment @covers AC-5`;
    assert.deepEqual(coveredIds(source), ['AC-5']);
  });

  test('a comment containing a quote character does not swallow real code as a string', () => {
    const source = ["// don't break on this apostrophe", "const real = 'value';"].join('\n');
    const out = extractComments(source);
    assert.match(out, /apostrophe/);
    assert.doesNotMatch(out, /value/);
  });
});

describe('coveredIds', () => {
  test('finds annotations and de-duplicates them', () => {
    assert.deepEqual(coveredIds('/** @covers AC-1 */\n// @covers AC-1\n// @covers AC-2'), [
      'AC-1',
      'AC-2',
    ]);
  });

  test('returns nothing when no annotation is present', () => {
    assert.deepEqual(coveredIds('const x = 1;'), []);
  });

  test('ignores @covers mentioned inside a string literal — not a real annotation', () => {
    const source = "const fixture = 'reasoning text that happens to say @covers AC-1';";
    assert.deepEqual(coveredIds(source), []);
  });

  test('ignores @covers inside a template literal fixture', () => {
    const source = 'const msg = `verdict cited @covers AC-2 in its explanation`;';
    assert.deepEqual(coveredIds(source), []);
  });

  test('still finds a real annotation alongside an unrelated string mention', () => {
    const source = [
      "const fixture = 'a test fixture mentioning @covers AC-9 as plain data';",
      '/** @covers AC-1 */',
    ].join('\n');
    assert.deepEqual(coveredIds(source), ['AC-1']);
  });
});

describe('buildTraceability', () => {
  test('classifies criteria as covered, untested and orphaned', () => {
    const root = mkdtempSync(join(tmpdir(), 'sentinel-trace-root-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });

    writeFileSync(join(root, 'src', 'login.ts'), '// @covers AC-1\n// @covers AC-2\n');
    writeFileSync(join(root, 'tests', 'login.test.ts'), '// @covers AC-1\n');

    const criteria = parseAcceptanceCriteria(
      writeSpec(['### AC-1: One', 'a', '', '### AC-2: Two', 'b', '', '### AC-3: Three', 'c'].join('\n')),
    );

    const byId = new Map(buildTraceability(root, criteria).map((row) => [row.acId, row]));
    assert.equal(byId.get('AC-1')?.status, 'covered');
    assert.equal(byId.get('AC-2')?.status, 'untested');
    assert.equal(byId.get('AC-3')?.status, 'orphaned');
  });
});

describe('changedFilesFromDiff', () => {
  test('extracts the post-image path from a modified file', () => {
    const diff = [
      'diff --git a/src/checkout.ts b/src/checkout.ts',
      'index abc123..def456 100644',
      '--- a/src/checkout.ts',
      '+++ b/src/checkout.ts',
      '@@ -1,3 +1,3 @@',
      '-old line',
      '+new line',
    ].join('\n');
    assert.deepEqual(changedFilesFromDiff(diff), ['src/checkout.ts']);
  });

  test('picks up both sides of a rename', () => {
    const diff = [
      'diff --git a/src/old-name.ts b/src/new-name.ts',
      'similarity index 100%',
      'rename from src/old-name.ts',
      'rename to src/new-name.ts',
      '--- a/src/old-name.ts',
      '+++ b/src/new-name.ts',
    ].join('\n');
    assert.deepEqual(
      changedFilesFromDiff(diff).sort(),
      ['src/new-name.ts', 'src/old-name.ts'].sort(),
    );
  });

  test('ignores /dev/null on an added or deleted file', () => {
    const added = ['diff --git a/src/new.ts b/src/new.ts', '--- /dev/null', '+++ b/src/new.ts'].join(
      '\n',
    );
    assert.deepEqual(changedFilesFromDiff(added), ['src/new.ts']);

    const deleted = [
      'diff --git a/src/gone.ts b/src/gone.ts',
      '--- a/src/gone.ts',
      '+++ /dev/null',
    ].join('\n');
    assert.deepEqual(changedFilesFromDiff(deleted), ['src/gone.ts']);
  });

  test('deduplicates and normalises windows separators', () => {
    const diff = ['--- a/src\\checkout.ts', '+++ b/src\\checkout.ts'].join('\n');
    assert.deepEqual(changedFilesFromDiff(diff), ['src/checkout.ts']);
  });

  test('returns nothing for a diff with no file headers', () => {
    assert.deepEqual(changedFilesFromDiff(''), []);
    assert.deepEqual(changedFilesFromDiff('just some prose, not a diff'), []);
  });
});

describe('affectedCriteria', () => {
  test('selects only criteria touched by the changed files', () => {
    const rows = [
      { acId: 'AC-1', title: 'One', coveredBy: ['src/a.ts'], testFiles: [], status: 'untested' as const },
      { acId: 'AC-2', title: 'Two', coveredBy: ['src/b.ts'], testFiles: [], status: 'untested' as const },
    ];
    const affected = affectedCriteria(['src/a.ts'], rows);
    assert.deepEqual(
      affected.map((row) => row.acId),
      ['AC-1'],
    );
  });

  test('normalises windows path separators', () => {
    const rows = [
      { acId: 'AC-1', title: 'One', coveredBy: ['src/a.ts'], testFiles: [], status: 'untested' as const },
    ];
    assert.equal(affectedCriteria(['src\\a.ts'], rows).length, 1);
  });
});

describe('bullet-form criteria', () => {
  test('are parsed from a file, not just from raw text', () => {
    const criteria = parseAcceptanceCriteria(
      writeSpec(['# PRD', '', '- AC-7: Checkout returns 201', '- AC-8: Refunds are logged'].join('\n')),
    );

    assert.deepEqual(
      criteria.map((ac) => ac.id),
      ['AC-7', 'AC-8'],
    );
    assert.equal(criteria[0]?.text, 'Checkout returns 201');
  });

  test('mix with heading-form criteria in one document', () => {
    const criteria = parseAcceptanceCriteriaFromText(
      ['### AC-1: Heading form', 'body one', '', '- AC-2: Bullet form'].join('\n'),
      'spec/PRD.md',
    );

    assert.deepEqual(
      criteria.map((ac) => ac.id),
      ['AC-1', 'AC-2'],
    );
  });
});

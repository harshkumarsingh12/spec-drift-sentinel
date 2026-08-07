import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  affectedCriteria,
  buildTraceability,
  coveredIds,
  parseAcceptanceCriteria,
  parseAcceptanceCriteriaFromText,
  parseTraceabilityMap,
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

describe('parseTraceabilityMap', () => {
  test('maps every AC to the fixture target and Playwright test', () => {
    const path = writeSpec(
      [
        '### AC-1: Login succeeds',
        'Valid users can log in.',
        '',
        '### AC-2: Logout succeeds',
        'Authenticated users can log out.',
      ].join('\n'),
    );

    const entries = parseTraceabilityMap(path);

    assert.deepEqual(entries, [
      {
        ac_id: 'AC-1',
        description: 'Valid users can log in.',
        target_files: ['src/fixture-app/server.ts'],
        associated_tests: ['tests/e2e/fixture.spec.ts'],
      },
      {
        ac_id: 'AC-2',
        description: 'Authenticated users can log out.',
        target_files: ['src/fixture-app/server.ts'],
        associated_tests: ['tests/e2e/fixture.spec.ts'],
      },
    ]);
  });

  test('supports bullet-form AC declarations', () => {
    const path = writeSpec('- AC-7: Checkout returns 201\n');

    const entries = parseTraceabilityMap(path);

    assert.deepEqual(entries, [
      {
        ac_id: 'AC-7',
        description: 'Checkout returns 201',
        target_files: ['src/fixture-app/server.ts'],
        associated_tests: ['tests/e2e/fixture.spec.ts'],
      },
    ]);
  });
});

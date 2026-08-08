import { test, expect } from '@playwright/test';
import { getAuditLog, getTraceability } from '../lib/data';

/**
 * @covers AC-4
 *
 * The matrix makes spec rot visible; the timeline is the audit trail a judge
 * scrolls to reconstruct who signed off on what. Both are read-only, so these
 * tests are about the information actually being present and distinguishable.
 *
 * Expectations come from lib/data.ts's real scan of spec/PRD.md and the repo
 * tree (matrix) and from `.sentinel/audit.jsonl` (timeline) — the same sources
 * the pages themselves read — so a passing test means the UI faithfully
 * reflects the real project, not a fixture standing in for it.
 */

test.describe('traceability matrix', () => {
  test('lists every criterion in the real spec', async ({ page }) => {
    const rows = getTraceability();
    await page.goto('/matrix');
    await expect(page.getByTestId('matrix-row')).toHaveCount(rows.length);
  });

  test('shows the real coverage status for every criterion', async ({ page }) => {
    const rows = getTraceability();
    await page.goto('/matrix');

    for (const row of rows) {
      const matrixRow = page.getByTestId('matrix-row').filter({ hasText: row.acId });
      await expect(matrixRow).toContainText(row.status);
    }
  });

  test('names the file claiming coverage, not just a checkmark', async ({ page }) => {
    const covered = getTraceability().find((r) => r.status === 'covered');
    if (!covered) throw new Error('expected at least one covered criterion in the real repo');
    const coveringFile = covered.testFiles[0] ?? covered.coveredBy[0];

    await page.goto('/matrix');
    const matrixRow = page.getByTestId('matrix-row').filter({ hasText: covered.acId });
    await expect(matrixRow).toContainText(coveringFile!);
  });

  test('says plainly when nothing covers a criterion', async ({ page }) => {
    const orphaned = getTraceability().find((r) => r.status === 'orphaned');
    test.skip(!orphaned, 'no orphaned criterion in the current spec — nothing to assert yet');

    await page.goto('/matrix');
    await expect(page.getByText('nothing claims this criterion')).toBeVisible();
  });
});

test.describe('audit timeline', () => {
  test('lists every recorded decision', async ({ page }) => {
    const entries = getAuditLog();
    await page.goto('/timeline');
    await expect(page.getByTestId('timeline-entry')).toHaveCount(entries.length);
  });

  test('shows pending, approved and rejected decisions', async ({ page }) => {
    await page.goto('/timeline');
    const all = (await page.getByTestId('timeline-entry').allTextContents()).join(' ');

    expect(all).toContain('pending');
    expect(all).toContain('approved');
    expect(all).toContain('rejected');
  });

  test('records who ratified a decision', async ({ page }) => {
    await page.goto('/timeline');
    await expect(page.getByText(/ratified by/).first()).toBeVisible();
  });

  test('orders newest first', async ({ page }) => {
    await page.goto('/timeline');
    const timestamps = await page.getByTestId('timeline-timestamp').allTextContents();

    const sorted = [...timestamps].sort().reverse();
    expect(timestamps).toEqual(sorted);
  });
});

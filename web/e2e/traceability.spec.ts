import { test, expect } from '@playwright/test';

/**
 * @covers AC-4
 *
 * The matrix makes spec rot visible; the timeline is the audit trail a judge
 * scrolls to reconstruct who signed off on what. Both are read-only, so these
 * tests are about the information actually being present and distinguishable.
 */

test.describe('traceability matrix', () => {
  test('lists every criterion', async ({ page }) => {
    await page.goto('/matrix');
    await expect(page.getByTestId('matrix-row')).toHaveCount(4);
  });

  test('distinguishes covered, untested and orphaned', async ({ page }) => {
    await page.goto('/matrix');

    const statuses = await page.getByTestId('matrix-row').locator('.badge').last().allTextContents();
    const all = (await page.getByTestId('matrix-row').allTextContents()).join(' ').toLowerCase();

    expect(all).toContain('covered');
    expect(all).toContain('untested');
    expect(all).toContain('orphaned');
    expect(statuses.length).toBeGreaterThan(0);
  });

  test('says plainly when nothing covers a criterion', async ({ page }) => {
    await page.goto('/matrix');
    await expect(page.getByText('nothing claims this criterion')).toBeVisible();
  });
});

test.describe('audit timeline', () => {
  test('lists recorded decisions', async ({ page }) => {
    await page.goto('/timeline');
    await expect(page.getByTestId('timeline-entry')).toHaveCount(4);
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

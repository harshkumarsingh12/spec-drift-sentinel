import { test, expect } from '@playwright/test';
import { getPendingVerdicts } from '../lib/data';

/**
 * @covers AC-1
 *
 * The inbox has to keep regressions and authorised changes visibly distinct.
 * A regression is NOT actionable: there is nothing to approve, because the fix
 * belongs in the code. If the UI ever offers a way to "resolve" one, the product
 * has quietly become the thing it exists to prevent.
 *
 * Expectations are read from `.sentinel/audit.jsonl` via lib/data.ts — the same
 * file and the same functions the dashboard itself uses — rather than hardcoded,
 * so these tests assert that the UI faithfully renders real backend state, not
 * that it matches a number typed into a spec file.
 */

test.describe('drift inbox', () => {
  test('lists pending verdicts', async ({ page }) => {
    const pending = getPendingVerdicts();
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: 'Drift inbox' })).toBeVisible();
    await expect(page.getByTestId('verdict-row')).toHaveCount(pending.length);
  });

  test('distinguishes regressions from authorised changes', async ({ page }) => {
    await page.goto('/inbox');
    const kinds = await page.getByTestId('verdict-kind').allTextContents();
    expect(kinds).toContain('regression');
    expect(kinds).toContain('intentional change');
  });

  test('a regression offers no route to approving anything', async ({ page }) => {
    await page.goto('/inbox');

    const regression = page
      .getByTestId('verdict-row')
      .filter({ has: page.getByTestId('verdict-kind').filter({ hasText: 'regression' }) });

    await expect(regression.first()).toContainText('Not actionable');
    // Wrapping it in a link would imply there is something to ratify.
    await expect(regression.locator('xpath=ancestor::a')).toHaveCount(0);
  });

  test('an authorised change links through to its proposal', async ({ page }) => {
    await page.goto('/inbox');

    const actionable = page
      .locator('a')
      .filter({ has: page.getByTestId('verdict-kind').filter({ hasText: 'intentional change' }) });

    await expect(actionable.first()).toBeVisible();
    await actionable.first().click();
    // Real verdict ids are UUIDs, not a fixed prefix — any non-empty id is fine.
    await expect(page).toHaveURL(/\/inbox\/[\w-]+$/);
  });

  test('surfaces low confidence rather than burying it', async ({ page }) => {
    const lowConfidence = getPendingVerdicts().find((v) => v.confidence < 0.6);
    if (!lowConfidence) throw new Error('seed data must include a low-confidence verdict — see scripts/seed-audit-log.mjs');
    const pct = `${Math.round(lowConfidence.confidence * 100)}%`;

    await page.goto('/inbox');
    await expect(page.getByTestId('low-confidence')).toBeVisible();
    await expect(page.getByTestId('low-confidence')).toContainText(pct);
  });
});

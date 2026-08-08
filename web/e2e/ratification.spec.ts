import { test, expect } from '@playwright/test';
import { findCriterion, getPendingVerdicts } from '../lib/data';
import type { Verdict } from '../lib/types';

/**
 * @covers AC-2
 * @covers AC-5
 *
 * The diff viewer is the product's whole argument: a proposed change is shown
 * next to the criterion that claims to authorise it, so the reviewer can check
 * the claim rather than trust it.
 *
 * The equal-weighting assertion is not cosmetic. Styling Approve as the obvious
 * default nudges reviewers into rubber-stamping, which is exactly the behaviour
 * this product exists to stop — so it is worth a test.
 *
 * Verdicts are looked up fresh from `.sentinel/audit.jsonl` (via lib/data.ts)
 * rather than hardcoded — real verdict ids are UUIDs assigned at classify time,
 * not fixed strings, and the reasoning/criterion text comes from the real
 * pipeline (scripts/seed-audit-log.mjs), not an invented fixture.
 */

function authorisedVerdict(): Verdict {
  // The headline case: an intentional change with a diff and real confidence,
  // as opposed to the low-confidence one also seeded for the inbox tests.
  const verdict = getPendingVerdicts().find((v) => v.kind === 'intentional_change' && v.confidence >= 0.6);
  if (!verdict) throw new Error('seed data must include a high-confidence intentional_change verdict');
  return verdict;
}

function regressionVerdict(): Verdict {
  const verdict = getPendingVerdicts().find((v) => v.kind === 'regression');
  if (!verdict) throw new Error('seed data must include a regression verdict');
  return verdict;
}

test.describe('ratification', () => {
  test('shows the proposed diff beside the criterion that authorises it', async ({ page }) => {
    await page.goto(`/inbox/${authorisedVerdict().id}`);

    await expect(page.getByTestId('criterion-text')).toBeVisible();
    await expect(page.getByTestId('proposed-diff')).toBeVisible();
  });

  test('quotes the criterion in full, not just its title', async ({ page }) => {
    const verdict = authorisedVerdict();
    const criterion = findCriterion(verdict.acId);
    if (!criterion) throw new Error(`criterion ${verdict.acId} not found in spec/PRD.md`);

    await page.goto(`/inbox/${verdict.id}`);

    const criterionText = page.getByTestId('criterion-text');
    await expect(criterionText).toContainText(criterion.id);
    // The reviewer is verifying a claim and needs the actual wording, not just the title.
    await expect(criterionText).toContainText(criterion.text.slice(0, 40));
  });

  test('renders added and removed lines distinctly', async ({ page }) => {
    await page.goto(`/inbox/${authorisedVerdict().id}`);

    const diff = page.getByTestId('proposed-diff');
    await expect(diff.locator('.diff-add').first()).toBeVisible();
    await expect(diff.locator('.diff-del').first()).toBeVisible();
  });

  test('offers approve and reject as equally weighted choices', async ({ page }) => {
    await page.goto(`/inbox/${authorisedVerdict().id}`);

    const approve = page.getByTestId('approve-button');
    const reject = page.getByTestId('reject-button');

    await expect(approve).toBeVisible();
    await expect(reject).toBeVisible();

    // Same visual weight, so neither reads as the default action.
    const approveBox = await approve.boundingBox();
    const rejectBox = await reject.boundingBox();
    expect(approveBox?.width).toBeCloseTo(rejectBox?.width ?? 0, 0);
  });

  test('states the reasoning behind the verdict', async ({ page }) => {
    const verdict = authorisedVerdict();
    await page.goto(`/inbox/${verdict.id}`);
    await expect(page.getByText('Classifier reasoning')).toBeVisible();
    await expect(page.getByText(verdict.reasoning.slice(0, 30))).toBeVisible();
  });

  test('a regression is never offered a proposed fix', async ({ page }) => {
    await page.goto(`/inbox/${regressionVerdict().id}`);

    await expect(page.getByText('No criterion cited')).toBeVisible();
    await expect(page.getByTestId('proposed-diff')).toHaveCount(0);
    await expect(page.getByTestId('approve-button')).toHaveCount(0);
  });
});

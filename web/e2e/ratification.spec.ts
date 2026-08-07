import { test, expect } from '@playwright/test';

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
 */

const AUTHORISED_VERDICT = '/inbox/v-8f21a4';

test.describe('ratification', () => {
  test('shows the proposed diff beside the criterion that authorises it', async ({ page }) => {
    await page.goto(AUTHORISED_VERDICT);

    await expect(page.getByTestId('criterion-text')).toBeVisible();
    await expect(page.getByTestId('proposed-diff')).toBeVisible();
  });

  test('quotes the criterion in full, not just its title', async ({ page }) => {
    await page.goto(AUTHORISED_VERDICT);

    const criterion = page.getByTestId('criterion-text');
    await expect(criterion).toContainText('AC-2');
    // The reviewer is verifying a claim and needs the actual wording.
    await expect(criterion).toContainText('taxed subtotal of 500 or more ship free');
  });

  test('renders added and removed lines distinctly', async ({ page }) => {
    await page.goto(AUTHORISED_VERDICT);

    const diff = page.getByTestId('proposed-diff');
    await expect(diff.locator('.diff-add').first()).toBeVisible();
    await expect(diff.locator('.diff-del').first()).toBeVisible();
  });

  test('offers approve and reject as equally weighted choices', async ({ page }) => {
    await page.goto(AUTHORISED_VERDICT);

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
    await page.goto(AUTHORISED_VERDICT);
    await expect(page.getByText('Classifier reasoning')).toBeVisible();
    await expect(page.getByText(/raised the free-shipping threshold/)).toBeVisible();
  });

  test('a regression is never offered a proposed fix', async ({ page }) => {
    // v-3c07be is the regression fixture: no criterion, no diff, nothing to approve.
    await page.goto('/inbox/v-3c07be');

    await expect(page.getByText('No criterion cited')).toBeVisible();
    await expect(page.getByTestId('proposed-diff')).toHaveCount(0);
    await expect(page.getByTestId('approve-button')).toHaveCount(0);
  });
});

import { test, expect } from '@playwright/test';

/**
 * @covers AC-1
 *
 * The inbox has to keep regressions and authorised changes visibly distinct.
 * A regression is NOT actionable: there is nothing to approve, because the fix
 * belongs in the code. If the UI ever offers a way to "resolve" one, the product
 * has quietly become the thing it exists to prevent.
 */

test.describe('drift inbox', () => {
  test('lists pending verdicts', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: 'Drift inbox' })).toBeVisible();
    await expect(page.getByTestId('verdict-row')).toHaveCount(3);
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

    await expect(regression).toHaveCount(1);
    await expect(regression).toContainText('Not actionable');
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
    await expect(page).toHaveURL(/\/inbox\/v-/);
  });

  test('surfaces low confidence rather than burying it', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByTestId('low-confidence')).toBeVisible();
    await expect(page.getByTestId('low-confidence')).toContainText('41%');
  });
});

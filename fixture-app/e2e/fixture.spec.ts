import { test, expect } from '@playwright/test';

/**
 * @covers AC-7
 * @covers AC-8
 * @covers AC-9
 *
 * These tests exist to be broken on purpose. Write them precisely: their
 * failure output is piped into `sentinel classify`, and a vague assertion
 * produces a vague failure message for the classifier to reason about.
 *
 * Assert on exact displayed values, not "contains a number".
 */

test.describe('cart API', () => {
  test('charges the flat fee below the threshold', async ({ request }) => {
    const res = await request.get('/api/cart?subtotal=400');
    expect(res.status()).toBe(200);

    expect(await res.json()).toEqual({ subtotal: 400, shippingFee: 4.99, total: 404.99 });
  });

  test('ships free at exactly the threshold', async ({ request }) => {
    // The boundary is where off-by-one bugs live, and 500 is the number the
    // criterion actually names. Do not soften this to 501.
    const res = await request.get('/api/cart?subtotal=500');

    expect(await res.json()).toEqual({ subtotal: 500, shippingFee: 0, total: 500 });
  });

  test('ships free above the threshold', async ({ request }) => {
    const res = await request.get('/api/cart?subtotal=750');

    expect(await res.json()).toEqual({ subtotal: 750, shippingFee: 0, total: 750 });
  });

  test('rejects a negative subtotal', async ({ request }) => {
    const res = await request.get('/api/cart?subtotal=-1');
    expect(res.status()).toBe(400);
  });

  test('creates an order with the shipping fee included', async ({ request }) => {
    const res = await request.post('/api/orders', { data: { subtotal: 400 } });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.total).toBe(404.99);
  });
});

test.describe('cart screen', () => {
  test('shows the flat fee below the threshold', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('subtotal-input').fill('400');
    await page.getByTestId('quote-button').click();

    await expect(page.getByTestId('shipping-fee')).toHaveText('4.99');
    await expect(page.getByTestId('total')).toHaveText('404.99');
  });

  test('shows a free fee as 0.00, not 0', async ({ page }) => {
    // AC-9 is about formatting specifically — "0" would be a real defect.
    await page.goto('/');
    await page.getByTestId('subtotal-input').fill('500');
    await page.getByTestId('quote-button').click();

    await expect(page.getByTestId('shipping-fee')).toHaveText('0.00');
    await expect(page.getByTestId('total')).toHaveText('500.00');
  });
});

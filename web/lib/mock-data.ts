import type { AcceptanceCriterion, AuditEntry, TraceabilityRow, Verdict } from './types';

/**
 * Fixtures for building the dashboard before the backend is wired up.
 *
 * These deliberately cover every state a view has to handle: an authorised
 * change with a diff, a regression with no diff, a low-confidence verdict, and
 * criteria in all three coverage states. If your view renders all of these
 * correctly it will render real data correctly.
 *
 * Timestamps are fixed rather than relative so screenshots and tests stay stable.
 *
 * Replace with real data by reading .sentinel/audit.jsonl in a server component.
 */

export const mockCriteria: AcceptanceCriterion[] = [
  {
    id: 'AC-1',
    title: 'Cart totals include tax before shipping is applied',
    text: 'The cart subtotal must have tax applied before any shipping calculation runs, so that shipping thresholds are evaluated against the taxed amount.',
    sourceFile: 'spec/PRD.md',
    line: 24,
  },
  {
    id: 'AC-2',
    title: 'Free shipping threshold is 500',
    text: 'Orders with a taxed subtotal of 500 or more ship free. Orders below 500 are charged the standard shipping fee of 4.99.',
    sourceFile: 'spec/PRD.md',
    line: 31,
  },
  {
    id: 'AC-3',
    title: 'Expired discount codes are rejected',
    text: 'A discount code past its expiry date must be rejected with a clear message and must not alter the cart total.',
    sourceFile: 'spec/PRD.md',
    line: 38,
  },
  {
    id: 'AC-4',
    title: 'Guest checkout requires an email address',
    text: 'A guest checkout cannot be submitted without a valid email address for the order confirmation.',
    sourceFile: 'spec/PRD.md',
    line: 45,
  },
];

export const mockVerdicts: Verdict[] = [
  // Authorised change, high confidence — the happy path for the diff viewer.
  {
    id: 'v-8f21a4',
    acId: 'AC-2',
    kind: 'intentional_change',
    confidence: 0.92,
    reasoning:
      'AC-2 raised the free-shipping threshold from 300 to 500. The test asserts free shipping at a subtotal of 400, which the criterion no longer grants. The implementation matches the updated criterion.',
    failure: {
      testFile: 'tests/checkout.spec.ts',
      testName: 'applies free shipping over the threshold',
      message: 'expected shippingFee to be 0 but received 4.99',
    },
    proposedDiff: `--- a/tests/checkout.spec.ts
+++ b/tests/checkout.spec.ts
@@ -18,8 +18,8 @@ test.describe('checkout', () => {
   test('applies free shipping over the threshold', async ({ page }) => {
     await addToCart(page, { sku: 'BOOK-1', price: 400 });
     await page.goto('/checkout');
-    // AC-2 previously set the threshold at 300
-    await expect(page.getByTestId('shipping-fee')).toHaveText('0.00');
+    // AC-2 sets the threshold at 500, so a 400 subtotal is still charged
+    await expect(page.getByTestId('shipping-fee')).toHaveText('4.99');
   });
 });`,
    model: 'llama-3.3-70b-versatile',
    createdAt: '2026-08-08T09:14:22.000Z',
  },

  // Regression — no diff, not actionable. Views must handle the nulls.
  {
    id: 'v-3c07be',
    acId: null,
    kind: 'regression',
    confidence: 0.88,
    reasoning:
      'No acceptance criterion authorises this change. AC-3 still requires expired discount codes to be rejected without altering the cart total, but the code now applies the discount before checking expiry. This is a defect in the implementation.',
    failure: {
      testFile: 'tests/discounts.spec.ts',
      testName: 'rejects an expired discount code',
      message: 'expected total to be 1200 but received 1080',
    },
    proposedDiff: null,
    model: 'llama-3.3-70b-versatile',
    createdAt: '2026-08-08T09:22:41.000Z',
  },

  // Low confidence — the UI must make this visible, not bury it.
  {
    id: 'v-b95d12',
    acId: 'AC-1',
    kind: 'intentional_change',
    confidence: 0.41,
    reasoning:
      'AC-1 may authorise reordering tax before shipping, but the criterion does not state explicitly whether the threshold is evaluated against the taxed or untaxed subtotal. Low confidence — a human should confirm the intent.',
    failure: {
      testFile: 'tests/checkout.spec.ts',
      testName: 'evaluates the shipping threshold after tax',
      message: 'expected shippingFee to be 0 but received 4.99',
    },
    proposedDiff: `--- a/tests/checkout.spec.ts
+++ b/tests/checkout.spec.ts
@@ -31,7 +31,7 @@ test.describe('checkout', () => {
   test('evaluates the shipping threshold after tax', async ({ page }) => {
     await addToCart(page, { sku: 'BOOK-2', price: 480 });
     await page.goto('/checkout');
-    await expect(page.getByTestId('shipping-fee')).toHaveText('4.99');
+    await expect(page.getByTestId('shipping-fee')).toHaveText('0.00');
   });
 });`,
    model: 'llama-3.3-70b-versatile',
    createdAt: '2026-08-08T09:31:05.000Z',
  },
];

export const mockTraceability: TraceabilityRow[] = [
  {
    acId: 'AC-1',
    title: 'Cart totals include tax before shipping is applied',
    coveredBy: ['src/checkout/totals.ts'],
    testFiles: ['tests/checkout.spec.ts'],
    status: 'covered',
  },
  {
    acId: 'AC-2',
    title: 'Free shipping threshold is 500',
    coveredBy: ['src/checkout/shipping.ts'],
    testFiles: ['tests/checkout.spec.ts'],
    status: 'covered',
  },
  {
    acId: 'AC-3',
    title: 'Expired discount codes are rejected',
    coveredBy: ['src/checkout/discounts.ts'],
    testFiles: [],
    status: 'untested',
  },
  {
    acId: 'AC-4',
    title: 'Guest checkout requires an email address',
    coveredBy: [],
    testFiles: [],
    status: 'orphaned',
  },
];

export const mockAuditLog: AuditEntry[] = [
  {
    verdictId: 'v-8f21a4',
    acId: 'AC-2',
    kind: 'intentional_change',
    reasoning: 'AC-2 raised the free-shipping threshold from 300 to 500.',
    model: 'llama-3.3-70b-versatile',
    proposedDiffHash: 'a3f8c21b904e',
    humanDecision: 'pending',
    decidedBy: null,
    timestamp: '2026-08-08T09:14:22.000Z',
  },
  {
    verdictId: 'v-3c07be',
    acId: null,
    kind: 'regression',
    reasoning: 'No acceptance criterion authorises this change.',
    model: 'llama-3.3-70b-versatile',
    proposedDiffHash: null,
    humanDecision: 'pending',
    decidedBy: null,
    timestamp: '2026-08-08T09:22:41.000Z',
  },
  {
    verdictId: 'v-77ae03',
    acId: 'AC-4',
    kind: 'intentional_change',
    reasoning: 'AC-4 added the email requirement, so the old test omitting it is stale.',
    model: 'llama-3.3-70b-versatile',
    proposedDiffHash: '6b1d90f4c2ae',
    humanDecision: 'approved',
    decidedBy: 'harshkumarsingh12',
    timestamp: '2026-08-08T08:47:10.000Z',
  },
  {
    verdictId: 'v-12cc5a',
    acId: 'AC-2',
    kind: 'intentional_change',
    reasoning: 'Proposed loosening the assertion to a range rather than an exact fee.',
    model: 'llama-3.3-70b-versatile',
    proposedDiffHash: 'f09b3ad71c55',
    humanDecision: 'rejected',
    decidedBy: 'harshkumarsingh12',
    timestamp: '2026-08-08T08:31:55.000Z',
  },
];

/** Only intentional changes are actionable — regressions carry no proposal. */
export const pendingVerdicts = mockVerdicts;

export function findVerdict(id: string): Verdict | undefined {
  return mockVerdicts.find((verdict) => verdict.id === id);
}

export function findCriterion(id: string | null): AcceptanceCriterion | undefined {
  if (id === null) return undefined;
  return mockCriteria.find((criterion) => criterion.id === id);
}

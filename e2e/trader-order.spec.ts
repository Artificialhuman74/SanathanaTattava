/**
 * E2E: Trader Order / Consumer Orders Page
 *
 * Verifies that a logged-in trader can navigate to the consumer orders
 * page and see the orders list render without crashing.
 */
import { test, expect } from '@playwright/test';
import { createAndLoginTrader } from './helpers/auth';

test.describe('Trader — consumer orders page', () => {
  let traderEmail: string;
  let traderPassword: string;

  test.beforeAll(async ({ request }) => {
    // Create a fresh trader account via the API helper
    const { email, password } = await createAndLoginTrader(request);
    traderEmail    = email;
    traderPassword = password;
  });

  test('trader can log in and navigate to /trader dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder(/email/i).fill(traderEmail);
    await page.getByPlaceholder(/password/i).fill(traderPassword);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL(/\/trader/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/trader/);
    // Body should render without an unhandled error
    await expect(page.locator('body')).not.toContainText('Cannot read');
  });

  test('consumer orders page renders a list or empty state', async ({ page }) => {
    // Inject token directly so we skip the login UI for speed
    await page.goto('/login');
    await page.getByPlaceholder(/email/i).fill(traderEmail);
    await page.getByPlaceholder(/password/i).fill(traderPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/trader/, { timeout: 10_000 });

    // Navigate to consumer orders
    await page.goto('/trader/consumer-orders');
    await expect(page).toHaveURL(/\/trader\/consumer-orders/);

    // Page should load without crashing — either a table, list or "no orders" message
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText('Cannot read');

    // Should have at least one meaningful element (table row OR heading OR empty state text)
    const hasContent = await page.locator('table, [role="table"], h1, h2, h3, p').count();
    expect(hasContent).toBeGreaterThan(0);
  });
});

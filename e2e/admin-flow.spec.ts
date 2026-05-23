/**
 * E2E: Admin Flow
 *
 * Verifies admin can log in and access key admin pages:
 * - /admin/settings — platform settings
 * - /admin/orders   — orders management
 *
 * Uses a known admin account (ravigbb@gmail.com).  If the account
 * doesn't exist or the server is not running these tests are skipped.
 */
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL    = 'ravigbb@gmail.com';
const ADMIN_PASSWORD = 'Bangalore@2114.';

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByPlaceholder(/email/i).fill(ADMIN_EMAIL);
  await page.getByPlaceholder(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/admin|\/trader/, { timeout: 10_000 });
}

test.describe('Admin — settings page', () => {
  test('admin logs in and /admin/settings renders', async ({ page, request }) => {
    // Quick health-check — skip if backend is not reachable
    const health = await request.get('http://localhost:5001/api/health').catch(() => null);
    if (!health?.ok()) {
      test.skip(true, 'Backend not running — skipping admin E2E');
      return;
    }

    await loginAsAdmin(page);

    // Only admin accounts land on /admin
    const url = page.url();
    if (!url.includes('/admin')) {
      test.skip(true, 'Admin account not available in this environment');
      return;
    }

    await page.goto('/admin/settings');
    await expect(page).toHaveURL(/\/admin\/settings/);
    await page.waitForLoadState('networkidle');

    // Settings page should show some form or heading
    const hasContent = await page.locator('h1, h2, form, input, label').count();
    expect(hasContent).toBeGreaterThan(0);
    await expect(page.locator('body')).not.toContainText('Cannot read');
  });
});

test.describe('Admin — orders page', () => {
  test('admin logs in and /admin/orders renders', async ({ page, request }) => {
    const health = await request.get('http://localhost:5001/api/health').catch(() => null);
    if (!health?.ok()) {
      test.skip(true, 'Backend not running — skipping admin E2E');
      return;
    }

    await loginAsAdmin(page);

    const url = page.url();
    if (!url.includes('/admin')) {
      test.skip(true, 'Admin account not available in this environment');
      return;
    }

    await page.goto('/admin/orders');
    await expect(page).toHaveURL(/\/admin\/orders/);
    await page.waitForLoadState('networkidle');

    // Orders page should render a table or "no orders" state
    const hasContent = await page.locator('table, [role="table"], h1, h2, h3, p').count();
    expect(hasContent).toBeGreaterThan(0);
    await expect(page.locator('body')).not.toContainText('Cannot read');
  });
});

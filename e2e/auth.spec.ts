/**
 * E2E: Authentication Flows
 *
 * Tests the full login/register/logout cycle for trader and consumer
 * through the actual browser UI.
 */
import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Trader Login
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Trader login', () => {
  test('registers then logs in and lands on /trader dashboard', async ({ page, request }) => {
    const email    = `trader-${Date.now()}@e2e.test`;
    const password = 'E2ePass123!';

    // Register via API (faster than filling form)
    await request.post('http://localhost:5001/api/auth/register', {
      data: { name: 'E2E Trader', email, password },
    });

    // Log in via UI
    await page.goto('/login');
    await page.getByPlaceholder(/email/i).fill(email);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should redirect to /trader
    await page.waitForURL(/\/trader/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/trader/);
  });

  test('shows error toast for wrong password', async ({ page, request }) => {
    const email = `wrong-${Date.now()}@e2e.test`;
    await request.post('http://localhost:5001/api/auth/register', {
      data: { name: 'Wrong Pass', email, password: 'CorrectPass1!' },
    });

    await page.goto('/login');
    await page.getByPlaceholder(/email/i).fill(email);
    await page.getByPlaceholder(/password/i).fill('WrongPass999!');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Toast error message should appear
    await expect(page.getByText(/invalid|password|credentials/i)).toBeVisible({ timeout: 5_000 });
  });

  test('shows error for non-existent account', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder(/email/i).fill('ghost@e2e.test');
    await page.getByPlaceholder(/password/i).fill('AnyPass123!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid|not found|password/i)).toBeVisible({ timeout: 5_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Consumer Login
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Consumer login', () => {
  test('registers, verifies OTP, then logs in and lands on /shop', async ({ page, request }) => {
    const email    = `consumer-${Date.now()}@e2e.test`;
    const password = 'ConsPass123!';

    // Register
    const regRes = await request.post('http://localhost:5001/api/auth/consumer/register', {
      data: { name: 'E2E Consumer', email, password },
    });
    const { dev_otp } = await regRes.json();

    // Verify OTP via API
    await request.post('http://localhost:5001/api/auth/consumer/verify-otp', {
      data: { email, otp: dev_otp },
    });

    // Log in via UI
    await page.goto('/shop/login');
    await page.getByPlaceholder(/email/i).fill(email);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL(/\/shop/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/shop/);
  });

  test('unverified consumer gets EMAIL_NOT_VERIFIED error', async ({ page, request }) => {
    const email = `unverified-${Date.now()}@e2e.test`;

    // Register but do NOT verify OTP
    await request.post('http://localhost:5001/api/auth/consumer/register', {
      data: { name: 'Unverified', email, password: 'Test123!' },
    });

    await page.goto('/shop/login');
    await page.getByPlaceholder(/email/i).fill(email);
    await page.getByPlaceholder(/password/i).fill('Test123!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/verify your email|not verified/i)).toBeVisible({ timeout: 5_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Logout', () => {
  test('trader logout clears token and redirects to /login', async ({ page, request }) => {
    const email    = `logout-${Date.now()}@e2e.test`;
    const password = 'LogoutTest1!';

    await request.post('http://localhost:5001/api/auth/register', {
      data: { name: 'Logout Trader', email, password },
    });

    // Login
    await page.goto('/login');
    await page.getByPlaceholder(/email/i).fill(email);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/trader/, { timeout: 10_000 });

    // Logout (find logout button in sidebar/header)
    await page.getByRole('button', { name: /logout|sign out/i }).click();

    // Should be back on /login
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    // Token should be gone
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeNull();
  });
});

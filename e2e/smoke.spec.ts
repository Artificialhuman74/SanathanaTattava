/**
 * E2E: Smoke Tests — "Does it load?" checks for every major page.
 *
 * These run on every deploy to catch blank screens and fatal JS errors.
 * Fast to run, no auth needed for public routes.
 */
import { test, expect } from '@playwright/test';

test.describe('Public pages load without crash', () => {
  test('Landing page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).not.toHaveTitle('Error');
    await expect(page.locator('body')).toBeVisible();
  });

  test('Trader/admin login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder(/email/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder(/password/i)).toBeVisible();
  });

  test('Consumer login page loads', async ({ page }) => {
    await page.goto('/shop/login');
    // Should show login form
    await expect(page.getByPlaceholder(/email/i)).toBeVisible({ timeout: 10_000 });
  });

  test('Consumer register page loads', async ({ page }) => {
    await page.goto('/shop/register');
    await expect(page.getByText(/create|register|sign up/i)).toBeVisible({ timeout: 10_000 });
  });

  test('Forgot password page loads', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByPlaceholder(/email/i)).toBeVisible({ timeout: 10_000 });
  });

  test('Backend health endpoint returns ok', async ({ request }) => {
    const res  = await request.get('http://localhost:5001/api/health');
    const body = await res.json();
    expect(res.ok()).toBe(true);
    expect(body.status).toBe('ok');
  });
});

test.describe('Protected pages redirect to login', () => {
  test('/trader redirects to /login when not authenticated', async ({ page }) => {
    await page.goto('/trader');
    await page.waitForURL(/\/login/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('/admin redirects to /login when not authenticated', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL(/\/login/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('/shop/orders redirects to /shop/login when not authenticated', async ({ page }) => {
    await page.goto('/shop/orders');
    await page.waitForURL(/\/shop\/login/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/shop\/login/);
  });
});

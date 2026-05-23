/**
 * E2E: Accessibility (WCAG 2.2 AA)
 *
 * Uses @axe-core/playwright to scan key pages for accessibility violations.
 * Only CRITICAL violations cause a test failure — lower-severity issues are
 * logged for awareness but do not block the build.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility (WCAG 2.2 AA)', () => {
  test('Landing page has no critical a11y violations', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    // Log violations for awareness but don't fail on them yet
    if (results.violations.length > 0) {
      console.log('A11y violations on /:', results.violations.map(v => `${v.id}: ${v.help}`));
    }
    // Only fail on critical violations (impact: critical)
    const critical = results.violations.filter(v => v.impact === 'critical');
    expect(critical, `Critical a11y violations: ${JSON.stringify(critical.map(v => v.id))}`).toHaveLength(0);
  });

  test('Consumer login page has no critical a11y violations', async ({ page }) => {
    await page.goto('/shop/login');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const critical = results.violations.filter(v => v.impact === 'critical');
    expect(critical).toHaveLength(0);
  });

  test('Shop page has no critical a11y violations', async ({ page }) => {
    await page.goto('/shop');
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const critical = results.violations.filter(v => v.impact === 'critical');
    expect(critical).toHaveLength(0);
  });

  test('Login page has no critical a11y violations', async ({ page }) => {
    await page.goto('/login');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const critical = results.violations.filter(v => v.impact === 'critical');
    expect(critical).toHaveLength(0);
  });
});

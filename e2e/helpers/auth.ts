/**
 * E2E Auth Helpers
 *
 * Seed users directly via the API and return auth tokens.
 * This is faster than filling registration forms for every test.
 */
import { APIRequestContext } from '@playwright/test';

const BASE = 'http://localhost:5001/api';

export async function createAndLoginTrader(
  request: APIRequestContext,
  overrides: { email?: string; password?: string; name?: string } = {}
) {
  const email    = overrides.email    || `trader-${Date.now()}@e2e.test`;
  const password = overrides.password || 'E2ePass123!';
  const name     = overrides.name     || 'E2E Trader';

  const reg = await request.post(`${BASE}/auth/register`, {
    data: { name, email, password },
  });
  const { token, user } = await reg.json();
  return { token, user, email, password };
}

export async function createAndLoginConsumer(
  request: APIRequestContext,
  overrides: { email?: string; password?: string; name?: string } = {}
) {
  const email    = overrides.email    || `consumer-${Date.now()}@e2e.test`;
  const password = overrides.password || 'E2ePass123!';
  const name     = overrides.name     || 'E2E Consumer';

  // Register — returns dev_otp because EMAIL_USER is not set in test env
  const reg = await request.post(`${BASE}/auth/consumer/register`, {
    data: { name, email, password },
  });
  const regBody = await reg.json();
  const otp = regBody.dev_otp;

  // Verify OTP
  const verify = await request.post(`${BASE}/auth/consumer/verify-otp`, {
    data: { email, otp },
  });
  const { token, consumer } = await verify.json();
  return { token, consumer, email, password };
}

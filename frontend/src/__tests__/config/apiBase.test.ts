import { describe, it, expect } from 'vitest';
import { shouldRotateApiBase } from '../../config/apiBase';

const res = (status: number, data: unknown = {}, headers: Record<string, string> = {}) =>
  ({ response: { status, data, headers } });

describe('shouldRotateApiBase', () => {
  it('switches servers when the request never got an answer', () => {
    expect(shouldRotateApiBase({ message: 'Network Error' })).toBe(true);
  });

  it('switches on gateway errors and Railway losing the app', () => {
    expect(shouldRotateApiBase(res(502))).toBe(true);
    expect(shouldRotateApiBase(res(503))).toBe(true);
    expect(shouldRotateApiBase(res(404, { message: 'Application not found' }))).toBe(true);
  });

  it("switches when Cloudflare can't reach the server", () => {
    for (const status of [520, 521, 522, 523, 524, 525, 526, 527, 530]) {
      expect(shouldRotateApiBase(res(status, '<html>', { 'content-type': 'text/html' }))).toBe(true);
    }
  });

  it('stays put on answers from our own server', () => {
    expect(shouldRotateApiBase(res(401, { error: 'No token' }))).toBe(false);
    expect(shouldRotateApiBase(res(404, { error: 'Product not found' }, { 'content-type': 'application/json' }))).toBe(false);
    expect(shouldRotateApiBase(res(500, { error: 'boom' }))).toBe(false);
  });
});

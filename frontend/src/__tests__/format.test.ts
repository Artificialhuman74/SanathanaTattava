/**
 * Part 15 — Frontend locale & INR formatting unit tests
 *
 * Pure unit tests — no React needed.
 */
import { describe, it, expect } from 'vitest';

describe('Indian locale number formatting (en-IN)', () => {
  it('formats 100000 as "1,00,000.00" in lakh system', () => {
    const result = (100000).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(result).toBe('1,00,000.00');
  });

  it('formats 1000 as "1,000.00"', () => {
    const result = (1000).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(result).toBe('1,000.00');
  });

  it('formats 10000000 (1 crore) correctly', () => {
    const result = (10000000).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    // 1,00,00,000.00 in Indian system
    expect(result).toBe('1,00,00,000.00');
  });
});

describe('Paise precision — commission rounding', () => {
  it('0.99 × 7 / 100 = 0.07 when rounded with toFixed(2)', () => {
    const amount = 0.99;
    const rate   = 7;
    const raw    = amount * rate / 100; // 0.0693
    const result = parseFloat(raw.toFixed(2));
    expect(result).toBe(0.07);
  });

  it('0.99 * 7 / 100 toFixed(2) is the string "0.07"', () => {
    const raw = (0.99 * 7) / 100;
    expect(raw.toFixed(2)).toBe('0.07');
  });

  it('100 × 10% = 10.00 exactly', () => {
    const amount = 100;
    const rate   = 10;
    const result = parseFloat((amount * rate / 100).toFixed(2));
    expect(result).toBe(10.00);
    expect((amount * rate / 100).toFixed(2)).toBe('10.00');
  });

  it('33.33 × 33.33% rounds to 11.11', () => {
    const amount = 33.33;
    const rate   = 33.33;
    const result = parseFloat((amount * rate / 100).toFixed(2));
    expect(result).toBe(11.11);
  });
});

describe('Currency display always shows 2 decimal places', () => {
  it('₹1.5 shows as "1.50" (2 decimal places)', () => {
    const amount = 1.5;
    const result = amount.toFixed(2);
    expect(result).toBe('1.50');
  });

  it('₹1 shows as "1.00" (2 decimal places)', () => {
    const amount = 1;
    expect(amount.toFixed(2)).toBe('1.00');
  });

  it('₹0.5 shows as "0.50"', () => {
    expect((0.5).toFixed(2)).toBe('0.50');
  });

  it('₹1000.1 shows as "1000.10"', () => {
    expect((1000.1).toFixed(2)).toBe('1000.10');
  });

  it('toLocaleString en-IN with fractionDigits always shows 2 decimals for integer', () => {
    const result = (500).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    // Should end in .00
    expect(result).toMatch(/\.00$/);
  });
});

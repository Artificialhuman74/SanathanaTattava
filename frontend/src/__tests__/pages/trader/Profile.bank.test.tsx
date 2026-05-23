/**
 * Trader Profile — bank details form validation
 *
 * Validates the client-side regex gates in handleBankSave:
 *   IFSC:    /^[A-Z]{4}0[A-Z0-9]{6}$/
 *   Account: /^\d{9,18}$/   (and the input strips non-digits as you type)
 *
 * The form does not POST until both regexes pass; toast.error is shown
 * instead. We assert by counting POST calls and reading the toast.
 */
import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'react-hot-toast';

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('../../../api/axios', () => ({
  default: {
    get: mockGet, post: mockPost,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'T', email: 't@x.com', role: 'trader', status: 'active', tier: 1 },
    token: 'tok', consumer: null, consumerToken: null, loading: false,
    isAdmin: false, isTrader: true, isTier1: true, isConsumer: false,
  }),
  consumerApi: {
    get: vi.fn(), put: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

import TraderProfile from '../../../pages/trader/Profile';

const profileData = {
  user: {
    id: 1, name: 'T', email: 't@x.com', phone: '9999999999',
    address: 'addr', pincode: '560001', tier: 1,
    referral_code: 'REF1', will_deliver: 0, delivery_enabled: 0,
    commission_rate: 7, latitude: null, longitude: null, h3_index: null,
    availability_status: 'available', status: 'active', created_at: '2026-01-01',
    bank_account_name: null, bank_account_number: null, bank_ifsc: null,
    razorpay_linked_account_id: null, razorpay_account_status: null,
  },
  referrer: null,
  subDealerCount: 0, consumerCount: 0,
  inventorySummary: { total_products: 0, total_units: 0, low_stock_count: 0 },
};

async function renderAndOpenBankForm() {
  const user = userEvent.setup();
  render(<><Toaster /><TraderProfile /></>);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());

  // Click the "Add" button next to the Bank Details section
  const addBtn = await screen.findByRole('button', { name: /^add$/i });
  await user.click(addBtn);
  return user;
}

function fillBank(values: { name: string; number: string; ifsc: string }) {
  const inputs = document.querySelectorAll('input');
  // Order of inputs inside the bank form section:
  // 0..N profile inputs, then: account-name, account-number, ifsc
  // We find them by placeholder/label instead.
  const nameInput   = screen.getByPlaceholderText(/as per bank records/i) as HTMLInputElement;
  const numberInput = screen.getAllByRole('textbox').find(
    (el) => (el as HTMLInputElement).value === '' &&
            (el as HTMLInputElement).getAttribute('inputmode') === 'numeric'
  ) as HTMLInputElement | undefined;

  // Fallback if inputmode-based detection misses
  const allInputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
  const ifscInput = allInputs.find(i => i.value === '' && i.maxLength === 11)
                 ?? allInputs[allInputs.length - 1];
  const accNumInput = numberInput ?? allInputs[allInputs.length - 2];

  return { nameInput, accNumInput, ifscInput, values, allInputs };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ data: profileData });
  mockPost.mockResolvedValue({ data: { success: true } });
});

describe('Trader Profile — bank details form', () => {
  test('rejects invalid IFSC (wrong format) and does not POST', async () => {
    const user = await renderAndOpenBankForm();

    const allInputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    // After opening the bank form we have 3 new empty inputs at the end
    const nameInput   = screen.getByPlaceholderText(/as per bank records/i) as HTMLInputElement;
    const accNumInput = allInputs[allInputs.indexOf(nameInput) + 1];
    const ifscInput   = allInputs[allInputs.indexOf(nameInput) + 2];

    await user.type(nameInput, 'Test Trader');
    await user.type(accNumInput, '123456789012');
    await user.type(ifscInput, 'BADIFSC');

    await user.click(screen.getByRole('button', { name: /save bank details|save/i }));

    await waitFor(() => expect(screen.getByText(/invalid ifsc code/i)).toBeTruthy());
    expect(mockPost).not.toHaveBeenCalledWith(
      '/payments/bank-details', expect.anything()
    );
  });

  test('rejects account number that is too short (<9 digits)', async () => {
    const user = await renderAndOpenBankForm();
    const allInputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const nameInput   = screen.getByPlaceholderText(/as per bank records/i) as HTMLInputElement;
    const accNumInput = allInputs[allInputs.indexOf(nameInput) + 1];
    const ifscInput   = allInputs[allInputs.indexOf(nameInput) + 2];

    await user.type(nameInput, 'Test Trader');
    await user.type(accNumInput, '12345678'); // 8 digits — too short
    await user.type(ifscInput, 'SBIN0123456');

    await user.click(screen.getByRole('button', { name: /save bank details|save/i }));

    await waitFor(() => expect(screen.getByText(/invalid account number/i)).toBeTruthy());
    expect(mockPost).not.toHaveBeenCalledWith(
      '/payments/bank-details', expect.anything()
    );
  });

  test('rejects when all fields empty', async () => {
    const user = await renderAndOpenBankForm();
    await user.click(screen.getByRole('button', { name: /save bank details|save/i }));
    await waitFor(() => expect(screen.getByText(/all bank fields are required/i)).toBeTruthy());
    expect(mockPost).not.toHaveBeenCalledWith(
      '/payments/bank-details', expect.anything()
    );
  });

  test('accepts valid IFSC + valid account number and POSTs', async () => {
    const user = await renderAndOpenBankForm();
    const allInputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const nameInput   = screen.getByPlaceholderText(/as per bank records/i) as HTMLInputElement;
    const accNumInput = allInputs[allInputs.indexOf(nameInput) + 1];
    const ifscInput   = allInputs[allInputs.indexOf(nameInput) + 2];

    await user.type(nameInput, 'Test Trader');
    await user.type(accNumInput, '123456789012');
    await user.type(ifscInput, 'sbin0123456'); // lowercased — gets toUpperCase()

    await user.click(screen.getByRole('button', { name: /save bank details|save/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/payments/bank-details',
        expect.objectContaining({
          bank_account_name: 'Test Trader',
          bank_account_number: '123456789012',
          bank_ifsc: 'SBIN0123456',
        })
      );
    });
  });
});

/**
 * ConfirmCommission page tests
 *
 * Covers: loading spinner, missing token, expired link, confirmed/disputed
 * states (both server-reported and user-action), confirm + dispute submissions.
 *
 * The page calls plain `axios` (not the `api` instance) against /public/...
 */
import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { get: mockGet, post: mockPost },
}));

vi.mock('../../config/apiBase', () => ({
  getApiHttpBaseUrl: () => '/api',
}));

import ConfirmCommission from '../../pages/ConfirmCommission';

const mkData = (overrides: Partial<any> = {}) => ({
  commission: {
    id: 42, amount: 250.75, rate: 7, type: 'override',
    status: 'awaiting_confirmation',
    payment_method: 'cash',
    paid_at_offline: '2026-05-20T10:00:00Z',
    payment_note: 'Paid in person',
    confirmed_at: null,
    disputed_at: null,
    dispute_reason: null,
    order_number: 'ORD-9001',
    order_amount: 3582.14,
    ...overrides.commission,
  },
  sub_dealer: { id: 7, name: 'Asha', email: 'asha@x.com' },
  parent:     { id: 3, name: 'Ravi', email: 'ravi@x.com' },
  expired: false,
  ...overrides,
});

function renderAt(url = '/confirm-commission?token=tok123') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ConfirmCommission />
    </MemoryRouter>
  );
}

describe('ConfirmCommission page', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  test('renders loading spinner while fetching', () => {
    mockGet.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderAt();
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  test('shows "Link Invalid" when token query param is missing', async () => {
    renderAt('/confirm-commission'); // no token
    await waitFor(() => {
      expect(screen.getByText(/link invalid/i)).toBeTruthy();
      expect(screen.getByText(/missing confirmation token/i)).toBeTruthy();
    });
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('shows "Link Expired" when server returns expired=true', async () => {
    mockGet.mockResolvedValue({ data: mkData({ expired: true }) });
    renderAt();
    await waitFor(() => expect(screen.getByText(/link expired/i)).toBeTruthy());
  });

  test('shows confirmed state when commission.status="paid"', async () => {
    mockGet.mockResolvedValue({
      data: mkData({ commission: { status: 'paid' } }),
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/payment confirmed/i)).toBeTruthy());
  });

  test('shows disputed state when commission.status="disputed"', async () => {
    mockGet.mockResolvedValue({
      data: mkData({ commission: { status: 'disputed' } }),
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/dispute submitted/i)).toBeTruthy());
  });

  test('renders the amount and parent name when awaiting_confirmation', async () => {
    mockGet.mockResolvedValue({ data: mkData() });
    renderAt();
    await waitFor(() => expect(screen.getByText(/₹250.75/)).toBeTruthy());
    expect(screen.getAllByText(/Ravi/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /yes, i received it/i })).toBeTruthy();
  });

  test('clicking "Yes, I received it" POSTs /confirm and shows success', async () => {
    mockGet.mockResolvedValue({ data: mkData() });
    mockPost.mockResolvedValue({ data: { success: true } });
    renderAt();
    await waitFor(() => screen.getByRole('button', { name: /yes, i received it/i }));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /yes, i received it/i }));

    await waitFor(() => expect(screen.getByText(/payment confirmed/i)).toBeTruthy());
    const [url] = mockPost.mock.calls[0];
    expect(url).toMatch(/\/public\/commission-confirmation\/tok123\/confirm$/);
  });

  test('dispute flow: open form, type reason, submit → disputed state', async () => {
    mockGet.mockResolvedValue({ data: mkData() });
    mockPost.mockResolvedValue({ data: { success: true } });
    renderAt();
    await waitFor(() => screen.getByRole('button', { name: /no, i didn'?t/i }));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /no, i didn'?t/i }));

    const textarea = await screen.findByPlaceholderText(/never received/i);
    await user.type(textarea, 'Cash never arrived');
    await user.click(screen.getByRole('button', { name: /submit dispute/i }));

    await waitFor(() => expect(screen.getByText(/dispute submitted/i)).toBeTruthy());
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toMatch(/\/public\/commission-confirmation\/tok123\/dispute$/);
    expect(body).toEqual({ reason: 'Cash never arrived' });
  });

  test('shows "Link Invalid" when fetch returns 404', async () => {
    mockGet.mockRejectedValue({ response: { status: 404, data: { error: 'Token not found' } } });
    renderAt();
    await waitFor(() => expect(screen.getByText(/link invalid/i)).toBeTruthy());
    expect(screen.getByText(/token not found/i)).toBeTruthy();
  });
});

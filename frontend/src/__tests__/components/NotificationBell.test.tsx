/**
 * NotificationBell Component Tests
 *
 * Covers: unread badge display, variant-specific API endpoints
 * (dealer/admin/consumer), empty-state rendering.
 */
import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// vi.hoisted ensures mocks are accessible inside vi.mock factories
const { mockApiGet, mockApiPut, mockConsumerGet, mockConsumerPut } = vi.hoisted(() => ({
  mockApiGet:      vi.fn(),
  mockApiPut:      vi.fn(),
  mockConsumerGet: vi.fn(),
  mockConsumerPut: vi.fn(),
}));

vi.mock('../../api/axios', () => ({
  default: {
    get:  mockApiGet,
    put:  mockApiPut,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null, token: null, consumer: null, consumerToken: null,
    loading: false, isAdmin: false, isTrader: false, isTier1: false, isConsumer: false,
  }),
  consumerApi: {
    get: mockConsumerGet,
    put: mockConsumerPut,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock('../../contexts/SocketContext', () => ({
  useSocket: () => ({ socket: null, on: vi.fn(), off: vi.fn() }),
}));

import NotificationBell from '../../components/NotificationBell';

const twoUnread = {
  notifications: [
    { id: 1, title: 'Order Confirmed', body: 'ORD-001 confirmed.', read: 0, created_at: new Date().toISOString() },
    { id: 2, title: 'Order Shipped',   body: 'ORD-002 shipped.',   read: 0, created_at: new Date().toISOString() },
  ],
  // Component reads data.unread_count directly — not derived from notification list
  unread_count: 2,
};

describe('NotificationBell', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── dealer variant ───────────────────────────────────────────────────────

  describe('variant="dealer"', () => {
    beforeEach(() => {
      mockApiGet.mockResolvedValue({ data: twoUnread });
      mockApiPut.mockResolvedValue({ data: { success: true } });
    });

    test('renders a clickable bell button', async () => {
      render(<NotificationBell variant="dealer" />);
      await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
      expect(document.querySelector('button')).toBeTruthy();
    });

    test('shows unread count badge (2 unread)', async () => {
      render(<NotificationBell variant="dealer" />);
      await waitFor(() => {
        expect(screen.getByText('2')).toBeTruthy();
      });
    });

    test('calls /api/notifications/dealer endpoint', async () => {
      render(<NotificationBell variant="dealer" />);
      await waitFor(() => {
        const [url] = mockApiGet.mock.calls[0];
        expect(url).toMatch(/notifications\/dealer/);
      });
    });

    test('does NOT call consumerApi for dealer variant', async () => {
      render(<NotificationBell variant="dealer" />);
      await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
      expect(mockConsumerGet).not.toHaveBeenCalled();
    });
  });

  // ── consumer variant ─────────────────────────────────────────────────────

  describe('variant="consumer"', () => {
    beforeEach(() => {
      mockConsumerGet.mockResolvedValue({ data: twoUnread });
      mockConsumerPut.mockResolvedValue({ data: { success: true } });
    });

    test('uses consumerApi (not main api) for fetching', async () => {
      render(<NotificationBell variant="consumer" />);
      await waitFor(() => expect(mockConsumerGet).toHaveBeenCalled());
      expect(mockApiGet).not.toHaveBeenCalled();
    });

    test('calls /api/notifications/consumer endpoint', async () => {
      render(<NotificationBell variant="consumer" />);
      await waitFor(() => {
        const [url] = mockConsumerGet.mock.calls[0];
        expect(url).toMatch(/notifications\/consumer/);
      });
    });
  });

  // ── admin variant ────────────────────────────────────────────────────────

  describe('variant="admin"', () => {
    beforeEach(() => {
      mockApiGet.mockResolvedValue({ data: { notifications: [] } });
    });

    test('calls /api/notifications/admin endpoint', async () => {
      render(<NotificationBell variant="admin" />);
      await waitFor(() => {
        const [url] = mockApiGet.mock.calls[0];
        expect(url).toMatch(/notifications\/admin/);
      });
    });

    test('shows no numeric badge when there are zero unread notifications', async () => {
      render(<NotificationBell variant="admin" />);
      await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
      // No digit badge expected
      expect(screen.queryByText(/^\d+$/)).toBeNull();
    });
  });
});

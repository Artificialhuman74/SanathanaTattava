/**
 * NotificationBell — sound-toggle persistence
 *
 * The bell stores its sound preference under `tradehub_sound_enabled` in
 * localStorage so the choice survives reloads. Default is ON (i.e. the
 * key is absent OR set to anything other than the literal string 'false').
 */
import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockApiGet, mockApiPut } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPut: vi.fn(),
}));

vi.mock('../../api/axios', () => ({
  default: {
    get: mockApiGet, put: mockApiPut,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null, token: null, consumer: null, consumerToken: null,
    loading: false, isAdmin: false, isTrader: false, isTier1: false, isConsumer: false,
  }),
  consumerApi: {
    get: vi.fn(), put: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock('../../contexts/SocketContext', () => ({
  useSocket: () => ({ socket: null, on: vi.fn(), off: vi.fn() }),
}));

vi.mock('../../services/notificationSound', () => ({
  playNotificationSound: vi.fn(),
  requestNotificationPermission: vi.fn().mockResolvedValue(false),
  showBrowserNotification: vi.fn(),
  isNotificationPermitted: () => false,
}));

import NotificationBell from '../../components/NotificationBell';
import { playNotificationSound } from '../../services/notificationSound';

const SOUND_KEY = 'tradehub_sound_enabled';

const oneUnread = {
  notifications: [
    { id: 1, title: 'Order', body: 'New order', read: 0, created_at: new Date().toISOString() },
  ],
  unread_count: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockApiGet.mockResolvedValue({ data: oneUnread });
  mockApiPut.mockResolvedValue({ data: { success: true } });
});

async function openBellAndGetSoundToggle() {
  const user = userEvent.setup();
  render(<NotificationBell variant="dealer" />);
  await waitFor(() => expect(mockApiGet).toHaveBeenCalled());

  // Open dropdown — outer button is the only top-level button before open
  const bellBtn = document.querySelector('button')!;
  await user.click(bellBtn);

  // Sound toggle is identified by its title attribute
  const toggle = await waitFor(() =>
    document.querySelector('button[title*="Sound"]') as HTMLButtonElement
  );
  expect(toggle).toBeTruthy();
  return { user, toggle };
}

describe('NotificationBell sound toggle', () => {
  test('defaults to ON when localStorage key is absent', async () => {
    const { toggle } = await openBellAndGetSoundToggle();
    expect(toggle.getAttribute('title')).toMatch(/sound on/i);
  });

  test('defaults to ON when key is "true"', async () => {
    localStorage.setItem(SOUND_KEY, 'true');
    const { toggle } = await openBellAndGetSoundToggle();
    expect(toggle.getAttribute('title')).toMatch(/sound on/i);
  });

  test('reads OFF when key is literal "false"', async () => {
    localStorage.setItem(SOUND_KEY, 'false');
    const { toggle } = await openBellAndGetSoundToggle();
    expect(toggle.getAttribute('title')).toMatch(/sound off/i);
  });

  test('clicking the toggle flips state and writes to localStorage', async () => {
    const { user, toggle } = await openBellAndGetSoundToggle();
    expect(localStorage.getItem(SOUND_KEY)).toBeNull(); // untouched

    await user.click(toggle);                            // ON → OFF
    expect(localStorage.getItem(SOUND_KEY)).toBe('false');
    expect(toggle.getAttribute('title')).toMatch(/sound off/i);

    await user.click(toggle);                            // OFF → ON
    expect(localStorage.getItem(SOUND_KEY)).toBe('true');
    expect(toggle.getAttribute('title')).toMatch(/sound on/i);
  });

  test('toggling unmute plays a preview chime', async () => {
    localStorage.setItem(SOUND_KEY, 'false');
    const { user, toggle } = await openBellAndGetSoundToggle();
    (playNotificationSound as any).mockClear();

    await user.click(toggle); // OFF → ON should play preview
    expect(playNotificationSound).toHaveBeenCalled();
  });

  test('toggling mute does NOT play a preview chime', async () => {
    const { user, toggle } = await openBellAndGetSoundToggle();
    (playNotificationSound as any).mockClear();

    await user.click(toggle); // ON → OFF should NOT play
    expect(playNotificationSound).not.toHaveBeenCalled();
  });
});

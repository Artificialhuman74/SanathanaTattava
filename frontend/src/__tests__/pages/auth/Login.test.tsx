/**
 * Login Page Tests
 *
 * Covers: form rendering, validation, successful login flow,
 * error display, trader/admin tab switching,
 * "forgot password" link appears after 401.
 */
import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Mock AuthContext
const mockLogin = vi.fn();
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    user: null,
    token: null,
    consumer: null,
    consumerToken: null,
    loading: false,
    isAdmin: false,
    isTrader: false,
    isTier1: false,
    isConsumer: false,
  }),
  consumerApi: {
    get: vi.fn(), put: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

// Mock react-router navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import Login from '../../../pages/Login';

function renderLogin() {
  return render(
    <MemoryRouter>
      <Toaster />
      <Login />
    </MemoryRouter>
  );
}

describe('Login page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  test('renders email and password inputs', () => {
    renderLogin();
    expect(screen.getByPlaceholderText(/email/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/password/i)).toBeTruthy();
  });

  test('renders Trader and Admin tabs', () => {
    renderLogin();
    expect(screen.getByText(/trader/i)).toBeTruthy();
    expect(screen.getByText(/admin/i)).toBeTruthy();
  });

  test('submit button is present', () => {
    renderLogin();
    // Sign In button should be in the DOM
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  test('calls login with email and password on submit', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    localStorage.setItem('user', JSON.stringify({ role: 'trader' }));

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/email/i),    'trader@test.com');
    await user.type(screen.getByPlaceholderText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('trader@test.com', 'Password123!');
    });
  });

  test('shows error toast on login failure', async () => {
    const error = { response: { data: { error: 'Invalid email or password' }, status: 401 } };
    mockLogin.mockRejectedValueOnce(error);

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/email/i),    'bad@test.com');
    await user.type(screen.getByPlaceholderText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeTruthy();
    });
  });

  test('shows additional Forgot Password hint after a 401 error (showForgot state)', async () => {
    const error = { response: { data: { error: 'Invalid email or password' }, status: 401 } };
    mockLogin.mockRejectedValueOnce(error);

    renderLogin();
    const user = userEvent.setup();

    // Count "forgot password" links BEFORE the 401
    const beforeCount = screen.queryAllByText(/forgot password/i).length;

    await user.type(screen.getByPlaceholderText(/email/i),    'bad@test.com');
    await user.type(screen.getByPlaceholderText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      // After 401, there should be MORE "forgot password" instances than before
      const afterCount = screen.queryAllByText(/forgot password/i).length;
      expect(afterCount).toBeGreaterThan(beforeCount);
    });
  });

  test('does not call login when email field is empty', async () => {
    renderLogin();
    const user = userEvent.setup();

    // Only fill password
    await user.type(screen.getByPlaceholderText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(mockLogin).not.toHaveBeenCalled();
  });

  test('does not call login when password field is empty', async () => {
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/email/i), 'trader@test.com');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(mockLogin).not.toHaveBeenCalled();
  });
});

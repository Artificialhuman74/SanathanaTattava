/**
 * RouteGuards tests
 *
 * Covers: PrivateRoute, DeliveryRoute, ConsumerRoute — auth/role redirects.
 * Each guard wraps a sentinel child and we assert the rendered URL via a
 * <Routes> tree inside MemoryRouter.
 */
import React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

import { PrivateRoute, DeliveryRoute, ConsumerRoute } from '../../components/RouteGuards';

const Protected = () => <div>PROTECTED</div>;
const Login = () => <div>LOGIN_PAGE</div>;
const ShopLogin = () => <div>SHOP_LOGIN_PAGE</div>;
const DeliveryLogin = () => <div>DELIVERY_LOGIN_PAGE</div>;
const AdminHome = () => <div>ADMIN_HOME</div>;
const TraderHome = () => <div>TRADER_HOME</div>;

const baseAuth = {
  user: null, token: null, consumer: null, consumerToken: null,
  loading: false, isAdmin: false, isTrader: false, isTier1: false, isConsumer: false,
};

beforeEach(() => { mockUseAuth.mockReset(); });

describe('PrivateRoute', () => {
  test('redirects unauthenticated → /login', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth });
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<PrivateRoute role="admin"><Protected /></PrivateRoute>} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('LOGIN_PAGE')).toBeTruthy();
  });

  test('admin visiting /trader → redirected to /admin', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 1, role: 'admin', name: 'A', email: 'a@x.com', status: 'active' },
    });
    render(
      <MemoryRouter initialEntries={['/trader']}>
        <Routes>
          <Route path="/trader" element={<PrivateRoute role="trader"><Protected /></PrivateRoute>} />
          <Route path="/admin"  element={<AdminHome />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('ADMIN_HOME')).toBeTruthy();
  });

  test('trader visiting /admin → redirected to /trader', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 2, role: 'trader', name: 'T', email: 't@x.com', status: 'active' },
    });
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin"  element={<PrivateRoute role="admin"><Protected /></PrivateRoute>} />
          <Route path="/trader" element={<TraderHome />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('TRADER_HOME')).toBeTruthy();
  });

  test('correct role → renders children', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 3, role: 'admin', name: 'A', email: 'a@x.com', status: 'active' },
    });
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<PrivateRoute role="admin"><Protected /></PrivateRoute>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('PROTECTED')).toBeTruthy();
  });

  test('shows spinner while loading', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, loading: true });
    const { container } = render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<PrivateRoute role="admin"><Protected /></PrivateRoute>} />
        </Routes>
      </MemoryRouter>
    );
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByText('PROTECTED')).toBeNull();
  });
});

describe('ConsumerRoute', () => {
  test('redirects unauthenticated consumer → /shop/login', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth });
    render(
      <MemoryRouter initialEntries={['/shop/orders']}>
        <Routes>
          <Route path="/shop/orders" element={<ConsumerRoute><Protected /></ConsumerRoute>} />
          <Route path="/shop/login"  element={<ShopLogin />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('SHOP_LOGIN_PAGE')).toBeTruthy();
  });

  test('logged-in consumer → renders children', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      consumer: { id: 9, name: 'C', email: 'c@x.com', status: 'active' },
      isConsumer: true,
    });
    render(
      <MemoryRouter initialEntries={['/shop/orders']}>
        <Routes>
          <Route path="/shop/orders" element={<ConsumerRoute><Protected /></ConsumerRoute>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('PROTECTED')).toBeTruthy();
  });
});

describe('DeliveryRoute', () => {
  test('redirects unauthenticated → /delivery/login', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth });
    render(
      <MemoryRouter initialEntries={['/delivery/dashboard']}>
        <Routes>
          <Route path="/delivery/dashboard" element={<DeliveryRoute><Protected /></DeliveryRoute>} />
          <Route path="/delivery/login"     element={<DeliveryLogin />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('DELIVERY_LOGIN_PAGE')).toBeTruthy();
  });

  test('non-trader (admin) → redirected to /delivery/login', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 1, role: 'admin', name: 'A', email: 'a@x.com', status: 'active' },
    });
    render(
      <MemoryRouter initialEntries={['/delivery/dashboard']}>
        <Routes>
          <Route path="/delivery/dashboard" element={<DeliveryRoute><Protected /></DeliveryRoute>} />
          <Route path="/delivery/login"     element={<DeliveryLogin />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('DELIVERY_LOGIN_PAGE')).toBeTruthy();
  });

  test('trader → renders children', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 2, role: 'trader', name: 'T', email: 't@x.com', status: 'active' },
    });
    render(
      <MemoryRouter initialEntries={['/delivery/dashboard']}>
        <Routes>
          <Route path="/delivery/dashboard" element={<DeliveryRoute><Protected /></DeliveryRoute>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('PROTECTED')).toBeTruthy();
  });
});

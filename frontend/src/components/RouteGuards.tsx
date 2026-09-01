import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LiquidLoader from './LiquidLoader';

/* The first thing anyone sees on a guarded route, so it is the loader that
 * sets the tone for the whole app. The `accent` prop the arc used to take is
 * gone: the drop carries the brand itself and does not tint. */
const Spinner = () => (
  <div className="flex items-center justify-center min-h-screen">
    <LiquidLoader size={96} />
  </div>
);

export const PrivateRoute = ({ children, role }: { children: React.ReactNode; role?: 'admin' | 'trader' }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/trader'} replace />;
  return <>{children}</>;
};

export const DeliveryRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/delivery/login" replace />;
  if (user.role !== 'trader' && user.role !== 'admin') return <Navigate to="/delivery/login" replace />;
  return <>{children}</>;
};

export const ConsumerRoute = ({ children }: { children: React.ReactNode }) => {
  const { consumer, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!consumer) return <Navigate to="/shop/login" replace />;
  return <>{children}</>;
};

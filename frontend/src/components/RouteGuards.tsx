import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Spinner = ({ accent = 'brand-600' }: { accent?: string }) => (
  <div className="flex items-center justify-center min-h-screen">
    <div className={`animate-spin rounded-full h-8 w-8 border-b-2 border-${accent}`} />
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
  if (loading) return <Spinner accent="emerald-600" />;
  if (!user) return <Navigate to="/delivery/login" replace />;
  if (user.role !== 'trader') return <Navigate to="/delivery/login" replace />;
  return <>{children}</>;
};

export const ConsumerRoute = ({ children }: { children: React.ReactNode }) => {
  const { consumer, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!consumer) return <Navigate to="/shop/login" replace />;
  return <>{children}</>;
};

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';

import Landing         from './pages/Landing';
import Login           from './pages/Login';
import Register        from './pages/Register';
import ForgotPassword  from './pages/ForgotPassword';
import ResetPassword   from './pages/ResetPassword';

import AdminLayout  from './layouts/AdminLayout';
import TraderLayout from './layouts/TraderLayout';
import ConsumerLayout from './layouts/ConsumerLayout';
import DeliveryLayout from './layouts/DeliveryLayout';

import AdminDashboard     from './pages/admin/Dashboard';
import AdminInventory     from './pages/admin/Inventory';
import AdminTraders       from './pages/admin/Traders';
import AdminOrders        from './pages/admin/Orders';
import AdminConsumerOrders from './pages/admin/ConsumerOrders';
import AdminCommissions   from './pages/admin/Commissions';
import AdminConsumers     from './pages/admin/Consumers';
import AdminSettings      from './pages/admin/Settings';
import AdminDealerInventory from './pages/admin/DealerInventory';

import TraderDashboard     from './pages/trader/Dashboard';
import TraderProducts      from './pages/trader/Products';
import TraderOrders        from './pages/trader/MyOrders';
import TraderSubDealers    from './pages/trader/SubDealers';
import TraderConsumerOrders from './pages/trader/ConsumerOrders';
import TraderCommissions   from './pages/trader/Commissions';
import TraderProfile       from './pages/trader/Profile';
import TraderInventory     from './pages/trader/Inventory';

import Shop                from './pages/consumer/Shop';
import ConsumerLogin       from './pages/consumer/Login';
import ConsumerRegister    from './pages/consumer/Register';
import ConsumerOrders      from './pages/consumer/Orders';
import ConsumerAddresses   from './pages/consumer/Addresses';
import ConsumerCheckout    from './pages/consumer/Checkout';
import ConsumerProfile     from './pages/consumer/Profile';
import ConsumerAccount     from './pages/consumer/Account';
import ConsumerSupport     from './pages/consumer/Support';
import VerifyPending       from './pages/consumer/VerifyPending';

import DeliveryLogin     from './pages/delivery/Login';
import DeliveryDashboard from './pages/delivery/Dashboard';
import DeliveryOrders    from './pages/delivery/Orders';
import DeliveryOrderDetail from './pages/delivery/OrderDetail';
import DeliveryHistory   from './pages/delivery/History';
import DeliveryProfile   from './pages/delivery/DeliveryProfile';

// Protected route for admin/trader
const PrivateRoute = ({ children, role }: { children: React.ReactNode; role?: 'admin' | 'trader' }) => {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/trader'} replace />;
  return <>{children}</>;
};

// Protected route for delivery partner
const DeliveryRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
    </div>
  );
  if (!user) return <Navigate to="/delivery/login" replace />;
  if (user.role !== 'trader') return <Navigate to="/delivery/login" replace />;
  return <>{children}</>;
};

// Protected route for consumer
const ConsumerRoute = ({ children }: { children: React.ReactNode }) => {
  const { consumer, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );
  if (!consumer) return <Navigate to="/shop/login" replace />;
  return <>{children}</>;
};

const AppRoutes = () => {
  const { user } = useAuth();
  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: { borderRadius: '12px', fontSize: '14px', fontWeight: '500' },
        }}
      />
      <Routes>
        <Route path="/"         element={<Landing />} />
        <Route path="/login"           element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/trader'} /> : <Login />} />
        <Route path="/register"        element={user ? <Navigate to="/trader" /> : <Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password"  element={<ResetPassword />} />

        {/* Admin routes */}
        <Route path="/admin" element={<PrivateRoute role="admin"><AdminLayout /></PrivateRoute>}>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard"       element={<AdminDashboard />} />
          <Route path="inventory"       element={<AdminInventory />} />
          <Route path="traders"         element={<AdminTraders />} />
          <Route path="orders"          element={<AdminOrders />} />
          <Route path="consumer-orders" element={<AdminConsumerOrders />} />
          <Route path="consumers"       element={<AdminConsumers />} />
          <Route path="commissions"     element={<AdminCommissions />} />
          <Route path="dealer-inventory" element={<AdminDealerInventory />} />
          <Route path="settings"        element={<AdminSettings />} />
        </Route>

        {/* Trader routes */}
        <Route path="/trader" element={<PrivateRoute role="trader"><TraderLayout /></PrivateRoute>}>
          <Route index element={<Navigate to="/trader/dashboard" replace />} />
          <Route path="dashboard"       element={<TraderDashboard />} />
          <Route path="products"        element={<TraderProducts />} />
          <Route path="orders"          element={<TraderOrders />} />
          <Route path="sub-dealers"     element={<TraderSubDealers />} />
          <Route path="consumer-orders" element={<TraderConsumerOrders />} />
          <Route path="commissions"     element={<TraderCommissions />} />
          <Route path="profile"         element={<TraderProfile />} />
          <Route path="inventory"       element={<TraderInventory />} />
        </Route>

        {/* Consumer / Shop routes */}
        <Route path="/shop" element={<ConsumerLayout />}>
          <Route index element={<Shop />} />
          <Route path="login"           element={<ConsumerLogin />} />
          <Route path="register"        element={<ConsumerRegister />} />
          <Route path="verify-pending"  element={<VerifyPending />} />
          <Route path="resend-verification" element={<VerifyPending />} />
          <Route path="orders"    element={<ConsumerRoute><ConsumerOrders /></ConsumerRoute>} />
          <Route path="addresses" element={<ConsumerRoute><ConsumerAddresses /></ConsumerRoute>} />
          <Route path="checkout"  element={<ConsumerCheckout />} />
          <Route path="profile"         element={<ConsumerRoute><ConsumerProfile /></ConsumerRoute>} />
          <Route path="profile/account" element={<ConsumerRoute><ConsumerAccount /></ConsumerRoute>} />
          <Route path="support"         element={<ConsumerSupport />} />
        </Route>

        {/* Delivery Partner routes */}
        <Route path="/delivery/login" element={<DeliveryLogin />} />
        <Route path="/delivery" element={<DeliveryRoute><DeliveryLayout /></DeliveryRoute>}>
          <Route index element={<Navigate to="/delivery/dashboard" replace />} />
          <Route path="dashboard" element={<DeliveryDashboard />} />
          <Route path="orders"    element={<DeliveryOrders />} />
          <Route path="orders/:id" element={<DeliveryOrderDetail />} />
          <Route path="history"   element={<DeliveryHistory />} />
          <Route path="profile"   element={<DeliveryProfile />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <AppRoutes />
      </SocketProvider>
    </AuthProvider>
  );
}

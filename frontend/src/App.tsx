import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useRubberBandScroll } from './hooks/useRubberBandScroll';
import { Toaster, toast } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { PrivateRoute, DeliveryRoute, ConsumerRoute } from './components/RouteGuards';
import { IS_PARTNER } from './appMode';

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
import AdminPayouts       from './pages/admin/Payouts';
import AdminConsumers     from './pages/admin/Consumers';
import AdminSettings      from './pages/admin/Settings';
import AdminDealerInventory from './pages/admin/DealerInventory';
import AdminFinance        from './pages/admin/Finance';
import AdminContainerDeposits from './pages/admin/ContainerDeposits';

import TraderDashboard     from './pages/trader/Dashboard';
import TraderProducts      from './pages/trader/Products';
import TraderOrders        from './pages/trader/MyOrders';
import TraderSubDealers    from './pages/trader/SubDealers';
import TraderConsumerOrders from './pages/trader/ConsumerOrders';
import TraderCommissions   from './pages/trader/Commissions';
import TraderProfile       from './pages/trader/Profile';
import TraderInventory     from './pages/trader/Inventory';
import TraderSubDealerCommissions from './pages/trader/SubDealerCommissions';
import ConfirmCommission   from './pages/ConfirmCommission';

import Shop                from './pages/consumer/Shop';
import ConsumerLogin       from './pages/consumer/Login';
import ConsumerRegister    from './pages/consumer/Register';
import ConsumerOrders      from './pages/consumer/Orders';
import ConsumerAddresses   from './pages/consumer/Addresses';
import ConsumerCheckout    from './pages/consumer/Checkout';
import ConsumerProfile     from './pages/consumer/Profile';
import ConsumerAccount     from './pages/consumer/Account';
import ConsumerSupport     from './pages/consumer/Support';
import ConsumerReview      from './pages/consumer/Review';
import VerifyPending       from './pages/consumer/VerifyPending';

import DeliveryLogin     from './pages/delivery/Login';
import DeliveryDashboard from './pages/delivery/Dashboard';
import DeliveryOrders    from './pages/delivery/Orders';
import DeliveryOrderDetail from './pages/delivery/OrderDetail';
import DeliveryHistory   from './pages/delivery/History';
import DeliveryProfile   from './pages/delivery/DeliveryProfile';

const PartnerRoutes = () => {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/trader'} replace /> : <Navigate to="/login" replace />} />
      <Route path="/login"           element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/trader'} /> : <Login />} />
      <Route path="/register"        element={user ? <Navigate to="/trader" /> : <Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password"  element={<ResetPassword />} />
      <Route path="/confirm-commission" element={<ConfirmCommission />} />

      <Route path="/admin" element={<PrivateRoute role="admin"><AdminLayout /></PrivateRoute>}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard"       element={<AdminDashboard />} />
        <Route path="inventory"       element={<AdminInventory />} />
        <Route path="traders"         element={<AdminTraders />} />
        <Route path="orders"          element={<AdminOrders />} />
        <Route path="consumer-orders" element={<AdminConsumerOrders />} />
        <Route path="consumers"       element={<AdminConsumers />} />
        <Route path="commissions"     element={<Navigate to="/admin/payouts" replace />} />
        <Route path="payouts"         element={<AdminPayouts />} />
        <Route path="dealer-inventory" element={<AdminDealerInventory />} />
        <Route path="finance"         element={<AdminFinance />} />
        <Route path="container-deposits" element={<AdminContainerDeposits />} />
        <Route path="settings"        element={<AdminSettings />} />
      </Route>

      <Route path="/trader" element={<PrivateRoute role="trader"><TraderLayout /></PrivateRoute>}>
        <Route index element={<Navigate to="/trader/dashboard" replace />} />
        <Route path="dashboard"       element={<TraderDashboard />} />
        <Route path="products"        element={<TraderProducts />} />
        <Route path="orders"          element={<TraderOrders />} />
        <Route path="sub-dealers"     element={<TraderSubDealers />} />
        <Route path="consumer-orders" element={<TraderConsumerOrders />} />
        <Route path="commissions"     element={<TraderCommissions />} />
        <Route path="sub-dealer-commissions" element={<TraderSubDealerCommissions />} />
        <Route path="profile"         element={<TraderProfile />} />
        <Route path="inventory"       element={<TraderInventory />} />
      </Route>

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
  );
};

const ConsumerRoutes = () => (
  <Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/reset-password"  element={<ResetPassword />} />

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
      <Route path="review"          element={<ConsumerReview />} />
    </Route>

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

const AppRoutes = () => {
  useRubberBandScroll();
  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{ duration: 3500 }}
      >
        {(t) => {
          const tone =
            t.type === 'success' ? { dot: 'bg-emerald-500', icon: '✓' } :
            t.type === 'error'   ? { dot: 'bg-red-500',     icon: '!' } :
                                   { dot: 'bg-slate-400',   icon: 'i' };
          const msg = typeof t.message === 'function' ? t.message(t) : t.message;
          return (
            <div
              onClick={() => toast.dismiss(t.id)}
              className={`flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-xl bg-white shadow-lg border border-slate-200 cursor-pointer max-w-sm ${
                t.visible ? 'animate-fade-in' : 'opacity-0'
              }`}
              style={{ transition: 'opacity 200ms' }}
            >
              <span className={`flex items-center justify-center w-5 h-5 rounded-full text-white text-xs font-bold flex-shrink-0 ${tone.dot}`}>
                {tone.icon}
              </span>
              <div className="flex-1 text-sm font-medium text-slate-800">{msg}</div>
              <button
                onClick={e => { e.stopPropagation(); toast.dismiss(t.id); }}
                aria-label="Dismiss"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex-shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          );
        }}
      </Toaster>
      {IS_PARTNER ? <PartnerRoutes /> : <ConsumerRoutes />}
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

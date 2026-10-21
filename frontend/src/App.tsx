import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useRubberBandScroll } from './hooks/useRubberBandScroll';
import { Toaster, toast } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { PrivateRoute, DeliveryRoute, ConsumerRoute } from './components/RouteGuards';
import { APP_MODE } from './appMode';
import LiquidLoader from './components/LiquidLoader';

// Every page and layout loads on its own, when first opened: the shop no longer downloads the
// admin, trader and delivery screens (and the other way round). Navigation runs in a transition
// (main.tsx), so the current screen stays up while the next one's code arrives.

const Landing         = lazy(() => import('./pages/Landing'));
const Login           = lazy(() => import('./pages/Login'));
const Register        = lazy(() => import('./pages/Register'));
const ForgotPassword  = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword   = lazy(() => import('./pages/ResetPassword'));

const AdminLayout  = lazy(() => import('./layouts/AdminLayout'));
const TraderLayout = lazy(() => import('./layouts/TraderLayout'));
const ConsumerLayout = lazy(() => import('./layouts/ConsumerLayout'));
const DeliveryLayout = lazy(() => import('./layouts/DeliveryLayout'));

const AdminDashboard     = lazy(() => import('./pages/admin/Dashboard'));
const AdminInventory     = lazy(() => import('./pages/admin/Inventory'));
const AdminTraders       = lazy(() => import('./pages/admin/Traders'));
const AdminOrders        = lazy(() => import('./pages/admin/Orders'));
const AdminConsumerOrders = lazy(() => import('./pages/admin/ConsumerOrders'));
const AdminCommissions   = lazy(() => import('./pages/admin/Commissions'));
const AdminPayouts       = lazy(() => import('./pages/admin/Payouts'));
const AdminConsumers     = lazy(() => import('./pages/admin/Consumers'));
const AdminSettings      = lazy(() => import('./pages/admin/Settings'));
const AdminDealerInventory = lazy(() => import('./pages/admin/DealerInventory'));
const AdminFinance        = lazy(() => import('./pages/admin/Finance'));
const AdminContainerFinance = lazy(() => import('./pages/admin/ContainerFinance'));
const AdminHoldings           = lazy(() => import('./pages/admin/Holdings'));
const AdminLuckyDraw          = lazy(() => import('./pages/admin/LuckyDraw'));
const AdminRiders             = lazy(() => import('./pages/admin/Riders'));
const AdminFleet              = lazy(() => import('./pages/admin/Fleet'));

const TraderDashboard     = lazy(() => import('./pages/trader/Dashboard'));
const TraderProducts      = lazy(() => import('./pages/trader/Products'));
const TraderOrders        = lazy(() => import('./pages/trader/MyOrders'));
const TraderSubDealers    = lazy(() => import('./pages/trader/SubDealers'));
const TraderConsumerOrders = lazy(() => import('./pages/trader/ConsumerOrders'));
const TraderCommissions   = lazy(() => import('./pages/trader/Commissions'));
const TraderProfile       = lazy(() => import('./pages/trader/Profile'));
const TraderInventory     = lazy(() => import('./pages/trader/Inventory'));
const TraderSubDealerCommissions = lazy(() => import('./pages/trader/SubDealerCommissions'));
const TraderLuckyDraw     = lazy(() => import('./pages/trader/LuckyDraw'));
const ConfirmCommission   = lazy(() => import('./pages/ConfirmCommission'));

const Shop                = lazy(() => import('./pages/consumer/Shop'));
const ConsumerLogin       = lazy(() => import('./pages/consumer/Login'));
const ConsumerRegister    = lazy(() => import('./pages/consumer/Register'));
const ConsumerOrders      = lazy(() => import('./pages/consumer/Orders'));
const ConsumerOrderTracking = lazy(() => import('./pages/consumer/OrderTracking'));
const ConsumerContainers  = lazy(() => import('./pages/consumer/Containers'));
const ConsumerWallet      = lazy(() => import('./pages/consumer/Wallet'));
const ConsumerAddresses   = lazy(() => import('./pages/consumer/Addresses'));
const ConsumerCheckout    = lazy(() => import('./pages/consumer/Checkout'));
const ConsumerProfile     = lazy(() => import('./pages/consumer/Profile'));
const ConsumerAccount     = lazy(() => import('./pages/consumer/Account'));
const ConsumerSupport     = lazy(() => import('./pages/consumer/Support'));
const ConsumerLegal       = lazy(() => import('./pages/consumer/Legal'));
const ConsumerReview      = lazy(() => import('./pages/consumer/Review'));
const VerifyPending       = lazy(() => import('./pages/consumer/VerifyPending'));
const ConsumerLuckyDraw   = lazy(() => import('./pages/consumer/LuckyDraw'));
const ConsumerTestConsole = lazy(() => import('./pages/consumer/TestConsole'));

const DeliveryLogin     = lazy(() => import('./pages/delivery/Login'));
const DeliveryDashboard = lazy(() => import('./pages/delivery/Dashboard'));
const DeliveryOrders    = lazy(() => import('./pages/delivery/Orders'));
const DeliveryOrderDetail = lazy(() => import('./pages/delivery/OrderDetail'));
const DeliveryHistory   = lazy(() => import('./pages/delivery/History'));
const DeliveryProfile   = lazy(() => import('./pages/delivery/DeliveryProfile'));
const DeliveryPickups   = lazy(() => import('./pages/delivery/ContainerPickups'));

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
        <Route path="riders"          element={<AdminRiders />} />
        <Route path="fleet"           element={<AdminFleet />} />
        <Route path="orders"          element={<AdminOrders />} />
        <Route path="consumer-orders" element={<AdminConsumerOrders />} />
        <Route path="consumers"       element={<AdminConsumers />} />
        <Route path="commissions"     element={<Navigate to="/admin/payouts" replace />} />
        <Route path="payouts"         element={<AdminPayouts />} />
        <Route path="dealer-inventory" element={<AdminDealerInventory />} />
        <Route path="finance"         element={<AdminFinance />} />
        <Route path="container-finance"   element={<AdminContainerFinance />} />
        <Route path="container-deposits"  element={<Navigate to="/admin/container-finance" replace />} />
        <Route path="manual-refunds"      element={<Navigate to="/admin/container-finance" replace />} />
        <Route path="holdings"          element={<AdminHoldings />} />
        <Route path="lucky-draw"        element={<AdminLuckyDraw />} />
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
        <Route path="lucky-draw"      element={<TraderLuckyDraw />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const DeliveryRoutes = () => {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/delivery/dashboard" replace /> : <Navigate to="/delivery/login" replace />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password"  element={<ResetPassword />} />

      <Route path="/delivery/login" element={<DeliveryLogin />} />
      <Route path="/delivery" element={<DeliveryRoute><DeliveryLayout /></DeliveryRoute>}>
        <Route index element={<Navigate to="/delivery/dashboard" replace />} />
        <Route path="dashboard" element={<DeliveryDashboard />} />
        <Route path="orders"    element={<DeliveryOrders />} />
        <Route path="orders/:id" element={<DeliveryOrderDetail />} />
        <Route path="pickups"   element={<DeliveryPickups />} />
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
      <Route path="orders/:id" element={<ConsumerRoute><ConsumerOrderTracking /></ConsumerRoute>} />
      <Route path="containers" element={<ConsumerRoute><ConsumerContainers /></ConsumerRoute>} />
      <Route path="wallet"     element={<ConsumerRoute><ConsumerWallet /></ConsumerRoute>} />
      <Route path="addresses" element={<ConsumerRoute><ConsumerAddresses /></ConsumerRoute>} />
      <Route path="checkout"  element={<ConsumerCheckout />} />
      <Route path="lucky-draw" element={<ConsumerRoute><ConsumerLuckyDraw /></ConsumerRoute>} />
      <Route path="test-console" element={<ConsumerRoute><ConsumerTestConsole /></ConsumerRoute>} />
      <Route path="profile"         element={<ConsumerRoute><ConsumerProfile /></ConsumerRoute>} />
      <Route path="profile/account" element={<ConsumerRoute><ConsumerAccount /></ConsumerRoute>} />
      <Route path="support"         element={<ConsumerSupport />} />
      <Route path="legal"           element={<ConsumerLegal />} />
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
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><LiquidLoader size={96} /></div>}>
        {APP_MODE === 'partner'  ? <PartnerRoutes /> :
         APP_MODE === 'delivery' ? <DeliveryRoutes /> :
                                   <ConsumerRoutes />}
      </Suspense>
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

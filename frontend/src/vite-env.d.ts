/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_URL_CANDIDATES?: string;
  readonly VITE_API_URL_FALLBACK?: string;
  readonly VITE_APP_MODE?: 'partner' | 'delivery' | 'consumer';
  readonly VITE_DELIVERY_URL?: string;
  readonly VITE_PARTNER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  Razorpay: any;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_API_URL_CANDIDATES?: string;
  readonly VITE_API_URL_FALLBACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  Razorpay: any;
}

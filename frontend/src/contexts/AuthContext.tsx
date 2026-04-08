import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import axios from 'axios';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'trader';
  tier?: number;
  referral_code?: string;
  referred_by_id?: number;
  phone?: string;
  address?: string;
  pincode?: string;
  will_deliver?: boolean;
  delivery_enabled?: boolean;
  commission_rate?: number;
  status: string;
}

export interface Consumer {
  id: number;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  pincode?: string;
  referral_code_used?: string;
  linked_dealer_id?: number;
  status: string;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
  phone?: string;
  address?: string;
  pincode?: string;
  referralCode?: string;
  willDeliver?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  consumer: Consumer | null;
  consumerToken: string | null;
  loading: boolean;
  /* Trader/Admin auth */
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  /* Consumer email+password auth */
  consumerLogin: (email: string, password: string) => Promise<void>;
  consumerRegister: (name: string, email: string, password: string, referralCode?: string, phone?: string) => Promise<void>;
  consumerLoginWithToken: (token: string, consumer: Consumer) => void;
  consumerLogout: () => void;
  refreshConsumer: () => Promise<void>;
  /* Convenience flags */
  isAdmin: boolean;
  isTrader: boolean;
  isTier1: boolean;
  isConsumer: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);

/* ── Axios instance for consumer calls (uses consumer_token) ──────────── */
export const consumerApi = axios.create({
  baseURL: (import.meta.env.VITE_API_URL ?? '') + '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

consumerApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('consumer_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user,          setUser]          = useState<User | null>(null);
  const [token,         setToken]         = useState<string | null>(null);
  const [consumer,      setConsumer]      = useState<Consumer | null>(null);
  const [consumerToken, setConsumerToken] = useState<string | null>(null);
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    const storedToken    = localStorage.getItem('token');
    const storedUser     = localStorage.getItem('user');
    const storedCToken   = localStorage.getItem('consumer_token');
    const storedConsumer = localStorage.getItem('consumer');

    if (storedToken && storedUser) {
      try { setToken(storedToken); setUser(JSON.parse(storedUser)); } catch { /* ignore */ }
    }
    if (storedCToken && storedConsumer) {
      try { setConsumerToken(storedCToken); setConsumer(JSON.parse(storedConsumer)); } catch { /* ignore */ }
    }
    setLoading(false);
  }, []);

  const persistUser = (t: string, u: User) => {
    localStorage.setItem('token', t);
    localStorage.setItem('user', JSON.stringify(u));
    setToken(t); setUser(u);
    window.dispatchEvent(new Event('tradehub-auth-changed'));
  };

  const persistConsumer = (t: string, c: Consumer) => {
    localStorage.setItem('consumer_token', t);
    localStorage.setItem('consumer', JSON.stringify(c));
    setConsumerToken(t); setConsumer(c);
    window.dispatchEvent(new Event('tradehub-auth-changed'));
  };

  /* ── Trader / Admin ──────────────────────────────────────────────────── */
  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    persistUser(data.token, data.user);
  }, []);

  const register = useCallback(async (formData: RegisterData) => {
    const { data } = await api.post('/auth/register', formData);
    persistUser(data.token, data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null); setUser(null);
    window.dispatchEvent(new Event('tradehub-auth-changed'));
  }, []);

  /* ── Consumer Email+Password Auth ───────────────────────────────────── */

  const consumerLogin = useCallback(async (email: string, password: string) => {
    const { data } = await api.post('/auth/consumer/login', { email, password });
    persistConsumer(data.token, data.consumer);
  }, []);

  const consumerRegister = useCallback(async (name: string, email: string, password: string, referralCode?: string, phone?: string) => {
    await api.post('/auth/consumer/register', { name, email, password, referral_code: referralCode || undefined, phone: phone || undefined });
    // Account created but not yet verified — do NOT log in yet
  }, []);

  const consumerLoginWithToken = useCallback((token: string, consumer: Consumer) => {
    persistConsumer(token, consumer);
  }, []);

  const consumerLogout = useCallback(() => {
    localStorage.removeItem('consumer_token');
    localStorage.removeItem('consumer');
    setConsumerToken(null); setConsumer(null);
    window.dispatchEvent(new Event('tradehub-auth-changed'));
  }, []);

  /** Re-fetch consumer profile from the server and update state + localStorage */
  const refreshConsumer = useCallback(async () => {
    try {
      const { data } = await consumerApi.get('/consumer/me');
      if (data.consumer) {
        localStorage.setItem('consumer', JSON.stringify(data.consumer));
        setConsumer(data.consumer);
      }
    } catch {
      // silently ignore — consumer stays as-is
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, token, consumer, consumerToken, loading,
      login, register, logout,
      consumerLogin, consumerRegister, consumerLoginWithToken, consumerLogout, refreshConsumer,
      isAdmin:    user?.role === 'admin',
      isTrader:   user?.role === 'trader',
      isTier1:    user?.role === 'trader' && user.tier === 1,
      isConsumer: consumer !== null,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

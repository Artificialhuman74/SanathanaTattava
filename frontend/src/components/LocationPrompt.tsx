import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, Navigation, AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import api from '../api/axios';

type Stage = 'loading' | 'prompt' | 'locating' | 'success' | 'error' | 'hidden';

interface LocationResponse {
  latitude: number | null;
  longitude: number | null;
  h3_index: string | null;
}

interface UpdateResponse {
  latitude: number;
  longitude: number;
  h3_index: string;
}

const SESSION_KEY = 'location_prompt_dismissed';

export default function LocationPrompt() {
  const [stage, setStage] = useState<Stage>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [h3Index, setH3Index] = useState('');

  // Check if dealer already has location set
  useEffect(() => {
    // If already dismissed this session, don't show
    if (sessionStorage.getItem(SESSION_KEY)) {
      setStage('hidden');
      return;
    }

    let cancelled = false;

    const checkLocation = async () => {
      try {
        const { data } = await api.get('/location/dealer/me');
        const loc = data.location || data;
        if (!cancelled) {
          if (loc.latitude && loc.longitude) {
            setStage('hidden');
          } else {
            setStage('prompt');
          }
        }
      } catch {
        // If endpoint fails (e.g. 404), show the prompt anyway
        if (!cancelled) setStage('prompt');
      }
    };

    checkLocation();
    return () => { cancelled = true; };
  }, []);

  const handleShareLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported by your browser. Please use a modern browser.');
      setStage('error');
      return;
    }

    setStage('locating');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const { data } = await api.put('/location/dealer/update', {
            latitude,
            longitude,
          });
          setH3Index(data.location?.h3_index || data.h3_index || '');
          setStage('success');
          // Auto-close after 3 seconds
          setTimeout(() => setStage('hidden'), 3000);
        } catch (err: any) {
          const msg = err?.response?.data?.message || err?.response?.data?.error || 'Failed to update location. Please try again.';
          setErrorMsg(msg);
          setStage('error');
        }
      },
      (error) => {
        let msg: string;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            msg = 'Location permission denied. Please allow location access in your browser settings and try again.';
            break;
          case error.POSITION_UNAVAILABLE:
            msg = 'Location information is unavailable. Please check your device\'s GPS settings.';
            break;
          case error.TIMEOUT:
            msg = 'Location request timed out. Please try again.';
            break;
          default:
            msg = 'An unknown error occurred while getting your location.';
        }
        setErrorMsg(msg);
        setStage('error');
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  }, []);

  const handleSkip = useCallback(() => {
    sessionStorage.setItem(SESSION_KEY, 'true');
    setStage('hidden');
  }, []);

  const handleRetry = useCallback(() => {
    setErrorMsg('');
    setStage('prompt');
  }, []);

  if (stage === 'hidden' || stage === 'loading') return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Set Your Shop Location</h2>
              <p className="text-emerald-100 text-sm">One-time setup for delivery assignments</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Prompt state */}
          {stage === 'prompt' && (
            <>
              <p className="text-slate-600 text-sm leading-relaxed">
                We use your location to assign nearby delivery orders to you.
                Please make sure you are at your shop/store before setting your location.
              </p>

              {/* Warning box */}
              <div className="flex gap-3 p-3.5 rounded-xl bg-amber-50 border border-amber-200">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-amber-800 text-sm leading-relaxed">
                  <span className="font-semibold">Please be at your shop!</span> Your GPS location is used to
                  assign deliveries to the nearest available dealer. Setting an incorrect location will result
                  in wrong delivery assignments.
                </p>
              </div>

              {/* Share Location button */}
              <button
                onClick={handleShareLocation}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold rounded-xl transition-colors shadow-sm shadow-emerald-200"
              >
                <Navigation className="w-4.5 h-4.5" />
                Share My Location
              </button>

              {/* Skip link */}
              <div className="text-center">
                <button
                  onClick={handleSkip}
                  className="text-xs text-slate-400 hover:text-slate-600 transition-colors underline underline-offset-2"
                >
                  Skip for now
                </button>
              </div>
            </>
          )}

          {/* Locating state */}
          {stage === 'locating' && (
            <div className="flex flex-col items-center py-6 gap-3">
              <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
              <p className="text-slate-600 text-sm font-medium">Getting your location...</p>
              <p className="text-slate-400 text-xs">Please allow location access if prompted</p>
            </div>
          )}

          {/* Success state */}
          {stage === 'success' && (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center animate-[scale-in_0.3s_ease-out]">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="text-slate-800 font-semibold">Location Set Successfully!</p>
              {h3Index && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-mono text-xs text-slate-600">{h3Index}</span>
                </div>
              )}
              <p className="text-slate-400 text-xs">You can update this anytime from your profile</p>
            </div>
          )}

          {/* Error state */}
          {stage === 'error' && (
            <>
              <div className="flex flex-col items-center py-4 gap-3">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <X className="w-6 h-6 text-red-500" />
                </div>
                <p className="text-slate-800 font-semibold text-center">Could Not Get Location</p>
                <p className="text-slate-500 text-sm text-center leading-relaxed">{errorMsg}</p>
              </div>

              <button
                onClick={handleRetry}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold rounded-xl transition-colors"
              >
                <Navigation className="w-4 h-4" />
                Try Again
              </button>

              <div className="text-center">
                <button
                  onClick={handleSkip}
                  className="text-xs text-slate-400 hover:text-slate-600 transition-colors underline underline-offset-2"
                >
                  Skip for now
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

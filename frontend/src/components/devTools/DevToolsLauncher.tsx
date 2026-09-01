import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import { FlaskConical } from 'lucide-react';

/**
 * Floating launcher for the dev-only Test Console — completely separate
 * from the real nav on purpose, so there's zero chance of it being mistaken
 * for a real product surface. Renders nothing unless the backend reports
 * dev tools are enabled (GET /api/dev-tools/status), which is only ever
 * true on local dev and the Railway "testing" environment — never
 * production, see backend/src/routes/devTools.js.
 */
export default function DevToolsLauncher() {
  const { consumer } = useAuth();
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!consumer) return;
    consumerApi.get('/dev-tools/status', { skipBaseRotation: true, skipAuthRedirect: true })
      .then(({ data }) => setEnabled(!!data.enabled))
      .catch(() => setEnabled(false));
  }, [consumer]);

  if (!enabled) return null;

  return (
    <button
      onClick={() => navigate('/shop/test-console')}
      className="fixed bottom-20 sm:bottom-5 right-4 z-30 flex items-center gap-1.5 pl-3 pr-3.5 py-2 rounded-full bg-slate-900 text-white text-xs font-semibold shadow-lg hover:bg-slate-800 transition-colors"
    >
      <FlaskConical size={13} />
      Test Console
    </button>
  );
}

/**
 * Notification Sound Service
 *
 * Generates a pleasant notification chime using the Web Audio API.
 * No external audio files needed — the sound is synthesized on-the-fly.
 *
 * Also handles Browser Push Notifications (Notification API).
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  // Resume if suspended (browsers require user gesture to start)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play a two-tone notification chime.
 * Short, pleasant, and non-intrusive.
 */
export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Two-note chime: C5 → E5 (major third — friendly sound)
    const notes = [
      { freq: 523.25, start: 0, duration: 0.12 },    // C5
      { freq: 659.25, start: 0.14, duration: 0.18 },  // E5
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = note.freq;

      // Smooth fade in/out to avoid clicks
      gain.gain.setValueAtTime(0, now + note.start);
      gain.gain.linearRampToValueAtTime(0.3, now + note.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.start + note.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + note.start);
      osc.stop(now + note.start + note.duration + 0.01);
    }
  } catch {
    // Audio not available — silently fail
  }
}

/* ── Browser Push Notifications ──────────────────────────────────────── */

/**
 * Request notification permission from the browser.
 * Returns true if granted, false otherwise.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Check if browser notifications are currently permitted.
 */
export function isNotificationPermitted(): boolean {
  return 'Notification' in window && Notification.permission === 'granted';
}

/**
 * Show a browser push notification.
 * Falls back silently if permission not granted.
 */
export function showBrowserNotification(
  title: string,
  body: string,
  options?: {
    icon?: string;
    tag?: string;
    onClick?: () => void;
  },
) {
  if (!isNotificationPermitted()) return;

  try {
    const notif = new Notification(title, {
      body,
      icon: options?.icon || '/Gemini_Generated_Image_agra6kagra6kagra.png',
      tag: options?.tag || `tradehub-${Date.now()}`,
      // silent: false → OS plays its default notification sound
    });

    if (options?.onClick) {
      notif.onclick = () => {
        window.focus();
        options.onClick!();
        notif.close();
      };
    }

    // Auto-close after 6 seconds
    setTimeout(() => notif.close(), 6000);
  } catch {
    // Notification API not available
  }
}

/**
 * AuthVisual — drenched right-side panel for the auth pages.
 *
 * Used by Login and Register on md+ viewports only. On mobile the
 * parent renders the form full-width and AuthVisual is not mounted.
 *
 * The panel is the moment of brand presence in the product UI: the
 * seal art at centre, an italic serif tagline below, a slow breathing
 * scale on the seal (collapses with prefers-reduced-motion).
 */

import React from 'react';

const AUTH_VISUAL_STYLES = `
  @keyframes auth-seal-breathe {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.018); }
  }
  @keyframes auth-halo-pulse {
    0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(1); }
    50%      { opacity: 0.75; transform: translate(-50%, -50%) scale(1.04); }
  }
  .auth-seal {
    animation: auth-seal-breathe 7s ease-in-out infinite;
  }
  .auth-halo {
    animation: auth-halo-pulse 8s ease-in-out infinite;
  }
  @keyframes auth-rise {
    0%   { opacity: 0; transform: translateY(10px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  .auth-rise        { animation: auth-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }
  .auth-rise-late   { animation: auth-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) 120ms both; }
  .auth-rise-later  { animation: auth-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) 240ms both; }

  @media (prefers-reduced-motion: reduce) {
    .auth-seal,
    .auth-halo,
    .auth-rise,
    .auth-rise-late,
    .auth-rise-later {
      animation: none !important;
    }
  }
`;

export function AuthVisual({ tagline }: { tagline: string }) {
  return (
    <aside
      aria-hidden="true"
      className="hidden md:block"
      /* The sticky inner block keeps the visual in view even when the
       * form column on the left grows tall (Register's long form). */
    >
      <style>{AUTH_VISUAL_STYLES}</style>
      <div
        className="sticky top-0 h-screen flex flex-col items-center justify-center overflow-hidden px-10"
        style={{
          background: 'radial-gradient(ellipse 90% 65% at 50% 30%, #0c3a1a 0%, #082613 100%)',
          color: '#dcd0b4',
        }}
      >
        {/* Soft gold halo behind the seal, slowly pulsing. */}
        <span
          aria-hidden="true"
          className="auth-halo absolute"
          style={{
            top:    '46%',
            left:   '50%',
            width:  'min(60%, 460px)',
            aspectRatio: '1',
            borderRadius: '50%',
            background:
              'radial-gradient(closest-side, rgba(232, 184, 109, 0.32), rgba(200, 150, 60, 0.10) 50%, transparent 78%)',
            filter: 'blur(10px)',
            pointerEvents: 'none',
          }}
        />

        {/* Seal art: the brand's wooden-ghani crest, centred. */}
        <div
          className="auth-seal relative rounded-full overflow-hidden"
          style={{
            width:        'clamp(220px, 30vw, 320px)',
            aspectRatio:  '1',
            boxShadow:
              '0 28px 70px -28px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(210, 156, 67, 0.30), inset 0 0 60px rgba(210, 156, 67, 0.12)',
          }}
        >
          <img
            src="/Gemini_Generated_Image_agra6kagra6kagra.png"
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
        </div>

        {/* Italic serif tagline below the seal. */}
        <p
          className="auth-rise-late relative mt-10 max-w-sm text-center"
          style={{
            fontFamily: "'Georgia', 'Times New Roman', serif",
            fontStyle:  'italic',
            fontSize:   'clamp(1rem, 1.4vw, 1.2rem)',
            lineHeight: 1.55,
            color:      '#dcd0b4',
          }}
        >
          {tagline}
        </p>

        {/* Tracked uppercase brand line, set quietly. */}
        <p
          className="auth-rise-later relative mt-6 text-[10px] font-semibold uppercase"
          style={{
            color:        '#b8ad94',
            letterSpacing: '0.32em',
          }}
        >
          Sanathana Tattva
        </p>
      </div>
    </aside>
  );
}

export const AUTH_RISE_STYLES = AUTH_VISUAL_STYLES;

import React from 'react';

interface LiquidLoaderProps {
  /** Overall height in px. The drop and its shadow scale together from this. */
  size?: number;
  /**
   * The line under the drop. Defaults to naming what the animation is doing;
   * pass something specific where a screen has a better answer, or `null` to
   * show the drop on its own.
   */
  label?: string | null;
  className?: string;
}

/**
 * Not "Loading…".
 *
 * The drop is filling with oil, so the line says so. It is the one word that
 * is literally true of the picture, true of the business, and the same on
 * every screen it appears on, which is what lets it become the app's own word
 * for waiting instead of a joke that wears out on the third read.
 */
const DEFAULT_LABEL = 'Pouring…';

/** The size the artwork is drawn at; everything scales from here. */
const ART_W = 180;
const ART_H = 200;

/** The drop's outline, in the 100×140 space the inner artwork is drawn in. */
const DROP_PATH =
  "path('M94 92 C94 116.3 74.3 136 50 136 C25.7 136 6 116.3 6 92 C6 62 42 40 50 4 C58 40 94 62 94 92 Z')";

/**
 * A drop of oil with the oil moving inside it.
 *
 * This is the app's general-purpose loader, replacing the spinning green arc.
 * A rotating arc says nothing about anything; a filling drop is the product
 * itself, and the wait reads as the press working rather than as the software
 * stalling.
 *
 * The artwork is drawn once at its native size and scaled by transform, so the
 * clip-path geometry, the gradients and the highlights all keep their exact
 * proportions at any size instead of being recomputed per instance.
 */
export default function LiquidLoader({ size = 80, label, className = '' }: LiquidLoaderProps) {
  const scale = size / ART_H;
  const caption = label === null ? null : (label ?? DEFAULT_LABEL);

  return (
    <div
      className={`flex flex-col items-center ${className}`}
      role="status"
      // Screen readers get the plain fact. "Pouring" is a flourish for the
      // eye; someone listening needs to know the page is still working.
      aria-label="Loading"
    >
      <div style={{ width: ART_W * scale, height: ART_H * scale }}>
        <div
          data-loader="liquid"
          aria-hidden="true"
          style={{
            position: 'relative',
            width: ART_W,
            height: ART_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* The shadow it sits in. */}
          <div style={{
            position: 'absolute', left: '50%', top: '58%', width: 130, height: 44,
            transform: 'translate(-50%, 0)', borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(120,80,20,0.22) 0%, rgba(120,80,20,0) 70%)',
            animation: 'liquidGlow 1.4s ease-in-out infinite',
          }} />

          <div style={{
            position: 'relative', width: 100, height: 140,
            filter: 'drop-shadow(0 12px 16px rgba(90,55,10,0.28)) drop-shadow(0 3px 4px rgba(90,55,10,0.18))',
          }}>
            {/* The rim, and the pale interior the oil fills. */}
            <div style={{ position: 'absolute', inset: 0, clipPath: DROP_PATH, background: '#6B4416' }} />
            <div style={{
              position: 'absolute', inset: 0, clipPath: DROP_PATH, background: '#FDF6EC',
              transform: 'scale(0.962)', transformOrigin: '50% 55%',
            }}>
              <div style={{
                position: 'absolute', left: '50%', top: '50%', width: 190, height: 190,
                transform: 'translate(-50%, -50%)',
              }}>
                <div style={{
                  position: 'absolute', left: 0, bottom: 0, width: '100%',
                  animation: 'liquidRise 0.8s cubic-bezier(0.45,0,0.55,1) infinite',
                  background:
                    'linear-gradient(to top, #5E3A0E 0%, #8A5A18 18%, #C08F2C 48%, #E3B95F 78%, #F3D999 96%),'
                    + ' radial-gradient(ellipse 70% 40% at 28% 85%, rgba(255,238,200,0.35), rgba(255,238,200,0) 70%)',
                }}>
                  <div style={{
                    position: 'absolute', left: '50%', bottom: '100%', width: 250, height: 250,
                    marginBottom: -238, borderRadius: '41%',
                    background: 'linear-gradient(to bottom, #E8C070, #C08F2C 60%)',
                    animation: 'liquidWave 1.5s linear infinite',
                  }} />
                  <div style={{
                    position: 'absolute', left: '50%', bottom: '100%', width: 225, height: 225,
                    marginBottom: -214, borderRadius: '45%',
                    background: 'linear-gradient(to bottom, #FBEBC4, #E3B95F 70%)',
                    opacity: 0.65,
                    animation: 'liquidWave2 2.1s linear infinite',
                  }} />
                </div>
              </div>

              {/* Glass: body shading, two specular catches, and the inner rim. */}
              <div style={{
                position: 'absolute', inset: 0,
                background:
                  'radial-gradient(ellipse 55% 40% at 30% 72%, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0) 60%),'
                  + ' radial-gradient(ellipse 70% 55% at 78% 88%, rgba(70,40,5,0.4) 0%, rgba(70,40,5,0) 65%),'
                  + ' linear-gradient(200deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 38%)',
              }} />
              <div style={{
                position: 'absolute', left: '26%', top: '56%', width: 20, height: 30,
                borderRadius: '50%', transform: 'rotate(-22deg)',
                background: 'radial-gradient(ellipse, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.15) 60%, rgba(255,255,255,0) 75%)',
              }} />
              <div style={{
                position: 'absolute', left: '52%', top: '22%', width: 9, height: 26,
                borderRadius: '50%', transform: 'rotate(10deg)',
                background: 'radial-gradient(ellipse, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 70%)',
              }} />
              <div style={{
                position: 'absolute', inset: 0,
                boxShadow: 'inset -6px -8px 14px rgba(90,55,10,0.35), inset 5px 6px 12px rgba(255,255,255,0.45)',
              }} />
            </div>
          </div>
        </div>
      </div>

      {caption && (
        <p className="text-sm mt-1 text-slate-600" aria-hidden="true">{caption}</p>
      )}
    </div>
  );
}

/**
 * The Sanathana Tattva seal, sunk into the dark green auth background.
 *
 * Purely decorative: Login and Register both carry the readable wordmark
 * themselves, so this is hidden from assistive tech and the img has no alt.
 * The wrapper clips the deliberately over-wide crest, so it can bleed past
 * the form column without ever giving the page a horizontal scrollbar.
 *
 * Sits behind everything: both pages put their content in a `relative`
 * column, which stacks above this in DOM order.
 */
export default function AuthCrest() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <img src="/logo.webp" alt="" className="auth-crest" />
    </div>
  );
}

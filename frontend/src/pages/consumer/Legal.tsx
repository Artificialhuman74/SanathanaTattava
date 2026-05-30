import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ScrollText, Lock, RotateCcw, Truck, ShieldCheck,
  ArrowLeft, ChevronRight, Mail, Phone, MapPin, Printer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* ───────────────────────────────────────────────────────────────────
 *  Sanathana Tattva — Legal Centre
 *
 *  Single page hosting the five policies:
 *    1. Terms of Service
 *    2. Privacy Policy
 *    3. Refund, Return & Cancellation Policy
 *    4. Shipping & Delivery Policy
 *    5. Grievance Officer & Contact
 *
 *  Layout: sticky sidebar TOC (desktop) / collapsible chip nav (mobile),
 *          long-form typography on the right, brand-aligned palette.
 * ───────────────────────────────────────────────────────────────────*/

const POLICY_VERSION = '1.0';
const LAST_UPDATED   = '29 May 2026';

const SECTIONS = [
  { id: 'terms',     label: 'Terms of Service',          icon: ScrollText },
  { id: 'privacy',   label: 'Privacy Policy',            icon: Lock },
  { id: 'refunds',   label: 'Refunds & Cancellations',   icon: RotateCcw },
  { id: 'shipping',  label: 'Shipping & Delivery',       icon: Truck },
  { id: 'grievance', label: 'Grievance & Contact',       icon: ShieldCheck },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

export default function Legal() {
  const location = useLocation();
  const [active, setActive] = useState<SectionId>('terms');
  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({
    terms: null, privacy: null, refunds: null, shipping: null, grievance: null,
  });

  /* Scroll to a deep-link target on mount (e.g. /shop/legal#privacy) */
  useEffect(() => {
    const hash = location.hash.replace('#', '') as SectionId;
    if (hash && SECTIONS.some(s => s.id === hash)) {
      requestAnimationFrame(() => {
        sectionRefs.current[hash]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActive(hash);
      });
    }
  }, [location.hash]);

  /* Highlight active section in the sidebar as the user scrolls */
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id as SectionId);
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    Object.values(sectionRefs.current).forEach(el => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const jumpTo = (id: SectionId) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    setActive(id);
  };

  return (
    <div className="min-h-screen bg-parchment-100">
      {/* ── Hero ───────────────────────────────────────────────────── */}
      <header className="relative bg-gradient-to-br from-brand-800 via-brand-700 to-brand-900 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-[0.08] bg-hero-pattern" />
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-gold-400 rounded-full blur-3xl opacity-20" />
        <div className="absolute -bottom-32 -left-24 w-96 h-96 bg-brand-500 rounded-full blur-3xl opacity-30" />

        <div className="relative max-w-5xl mx-auto px-6 sm:px-8 pt-10 pb-16 sm:pt-14 sm:pb-20">
          <Link
            to="/shop"
            className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft size={14} /> Back to shop
          </Link>

          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-gold-300/90 font-medium">
              <span className="w-6 h-px bg-gold-300/60" />
              Legal Centre
            </span>
          </div>

          <h1
            className="text-4xl sm:text-5xl font-bold leading-tight tracking-tight mb-4"
            style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
          >
            Our Promises, <span className="text-gold-300">in Writing</span>
          </h1>
          <p className="text-base sm:text-lg text-white/75 max-w-2xl leading-relaxed">
            Plain-language policies covering how we sell, ship, refund, and protect your data.
            We believe the small print should be readable — so here it is.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur border border-white/15 text-white/80">
              <span className="w-1.5 h-1.5 rounded-full bg-gold-300" />
              Version {POLICY_VERSION}
            </span>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur border border-white/15 text-white/80">
              Updated {LAST_UPDATED}
            </span>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 backdrop-blur border border-white/15 text-white/80 transition-colors"
            >
              <Printer size={12} /> Print / Save PDF
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile chip nav ────────────────────────────────────────── */}
      <div className="lg:hidden sticky top-0 z-30 bg-parchment-100/95 backdrop-blur border-b border-parchment-300/60">
        <div className="max-w-5xl mx-auto px-4 py-3 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {SECTIONS.map(s => {
              const isActive = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => jumpTo(s.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-brand-700 text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-parchment-300/60 hover:border-brand-200'
                  }`}
                >
                  <s.icon size={13} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Body: sticky sidebar + content ─────────────────────────── */}
      <main className="max-w-6xl mx-auto px-6 sm:px-8 py-12 sm:py-16">
        <div className="grid lg:grid-cols-[260px_1fr] gap-10 lg:gap-14">
          {/* Sidebar (desktop) */}
          <aside className="hidden lg:block">
            <div className="sticky top-8">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold mb-3">
                On this page
              </p>
              <nav className="space-y-0.5">
                {SECTIONS.map(s => {
                  const isActive = active === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => jumpTo(s.id)}
                      className={`group w-full text-left flex items-center gap-3 pl-3 pr-2 py-2.5 rounded-lg text-sm transition-all border-l-2 ${
                        isActive
                          ? 'border-brand-700 bg-white text-brand-800 font-semibold shadow-card'
                          : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/50'
                      }`}
                    >
                      <s.icon size={15} className={isActive ? 'text-brand-700' : 'text-slate-400 group-hover:text-slate-600'} />
                      <span className="flex-1">{s.label}</span>
                      <ChevronRight
                        size={13}
                        className={`transition-opacity ${isActive ? 'opacity-100 text-brand-700' : 'opacity-0'}`}
                      />
                    </button>
                  );
                })}
              </nav>

              <div className="mt-8 p-4 rounded-xl bg-white border border-parchment-300/60 shadow-card">
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400 font-semibold mb-2">
                  Need a human?
                </p>
                <p className="text-sm text-slate-700 leading-relaxed">
                  Anything unclear, write to{' '}
                  <a href="mailto:support@sanathanatattva.shop" className="text-brand-700 font-medium hover:underline">
                    support@sanathanatattva.shop
                  </a>{' '}
                  — we read every email.
                </p>
              </div>
            </div>
          </aside>

          {/* Content */}
          <div className="space-y-16 sm:space-y-20">
            <PolicyTerms     refEl={(el) => sectionRefs.current.terms     = el} />
            <PolicyPrivacy   refEl={(el) => sectionRefs.current.privacy   = el} />
            <PolicyRefunds   refEl={(el) => sectionRefs.current.refunds   = el} />
            <PolicyShipping  refEl={(el) => sectionRefs.current.shipping  = el} />
            <PolicyGrievance refEl={(el) => sectionRefs.current.grievance = el} />
          </div>
        </div>
      </main>

      {/* ── Footer strip with compliance details ──────────────────── */}
      <footer className="mt-12 bg-brand-900 text-white/80">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 py-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-8 text-sm">
          <div>
            <p
              className="text-white font-semibold text-base mb-2"
              style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
            >
              Sanathana Tattva
            </p>
            <p className="text-white/60 text-xs leading-relaxed">
              Operated by Gravity Traders — pure, cold-pressed oils delivered across South India.
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-white/40 text-[11px] uppercase tracking-wider">Compliance</p>
            <p>FSSAI Reg. No.: <span className="text-white/90 tracking-wide">21226159000012</span></p>
            <p>GSTIN: <span className="text-white/90 tracking-wide">29AIGPB6124Q2ZW</span></p>
            <p>Registered: <span className="text-white/90">Tumkur, Karnataka, India</span></p>
          </div>
          <div className="space-y-1.5">
            <p className="text-white/40 text-[11px] uppercase tracking-wider">Reach us</p>
            <p className="flex items-center gap-2"><Mail size={13} /> support@sanathanatattva.shop</p>
            <p className="flex items-center gap-2"><Phone size={13} /> <a href="tel:+919972922415" className="hover:text-white">+91 99729 22415</a></p>
            <p className="flex items-start gap-2"><MapPin size={13} className="mt-0.5" /> 164/1A, Halekatte, Kachihalli Village, Mayasandra, Turuvekere Taluk, Tumkur — 572227, Karnataka</p>
          </div>
        </div>
        <div className="border-t border-white/5">
          <p className="max-w-6xl mx-auto px-6 sm:px-8 py-4 text-[11px] text-white/40 text-center">
            © {new Date().getFullYear()} Sanathana Tattva. All rights reserved. Policies v{POLICY_VERSION}.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 *  Reusable section primitives — every policy uses these so spacing
 *  and typography stay consistent.
 * ═══════════════════════════════════════════════════════════════════*/

function Section({
  id, icon: Icon, eyebrow, title, intro, children, refEl,
}: {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
  refEl: (el: HTMLElement | null) => void;
}) {
  return (
    <section id={id} ref={refEl} className="scroll-mt-24 sm:scroll-mt-10">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-brand-50 text-brand-700">
          <Icon size={16} />
        </span>
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">{eyebrow}</p>
      </div>
      <h2
        className="text-3xl sm:text-4xl font-bold text-brand-900 leading-tight mb-3"
        style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
      >
        {title}
      </h2>
      <p className="text-slate-600 leading-relaxed mb-8 max-w-2xl">{intro}</p>
      <div className="space-y-7">{children}</div>
    </section>
  );
}

function Clause({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white border border-parchment-300/60 shadow-card overflow-hidden">
      <div className="px-6 pt-5 pb-1 flex items-baseline gap-3">
        <span className="text-[11px] font-semibold text-brand-700 tracking-wider tabular-nums">{n}</span>
        <h3 className="text-base sm:text-[17px] font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="px-6 pb-5 pt-2 text-[14.5px] text-slate-700 leading-[1.75] space-y-3 [&_strong]:text-slate-900 [&_strong]:font-semibold [&_a]:text-brand-700 [&_a]:underline [&_a:hover]:text-brand-800">
        {children}
      </div>
    </div>
  );
}

function Callout({ tone = 'brand', title, children }: { tone?: 'brand' | 'amber' | 'rose'; title?: string; children: React.ReactNode }) {
  const palette: Record<string, string> = {
    brand: 'bg-brand-50 border-brand-200/70 text-brand-900',
    amber: 'bg-gold-50 border-gold-200/70 text-gold-900',
    rose:  'bg-rose-50 border-rose-200/70 text-rose-900',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed ${palette[tone]}`}>
      {title && <p className="font-semibold mb-1">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2 pl-1">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-2 inline-block w-1 h-1 rounded-full bg-brand-600 flex-shrink-0" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 *  THE POLICIES
 * ═══════════════════════════════════════════════════════════════════*/

function PolicyTerms({ refEl }: { refEl: (el: HTMLElement | null) => void }) {
  return (
    <Section
      id="terms"
      icon={ScrollText}
      eyebrow="Document 1"
      title="Terms of Service"
      intro="By creating an account, browsing, or buying from Sanathana Tattva, you agree to the terms below. These govern the entire relationship between you and Gravity Traders (the legal entity operating this platform)."
      refEl={refEl}
    >
      <Clause n="1.01" title="Who can use this service">
        <p>
          You must be at least 18 years old to create an account and place orders.
          By signing up you confirm that the details you've shared — name, email,
          phone, address — are accurate and belong to you.
        </p>
      </Clause>

      <Clause n="1.02" title="Your account">
        <p>
          You may sign in with phone OTP, Google, or email + password. You are
          responsible for keeping your login credentials confidential. Activity
          performed under your account is treated as your own.
        </p>
        <p>
          We may suspend or terminate accounts engaged in fraud, abuse, or
          violations of these terms — with notice where practical.
        </p>
      </Clause>

      <Clause n="1.03" title="Orders, pricing, and acceptance">
        <p>
          All product prices listed on the site are in Indian Rupees and are{' '}
          <strong>inclusive of GST</strong>. The MRP is final; container deposits
          (where applicable) are charged separately and disclosed before checkout.
        </p>
        <p>
          An order placed by you is an <strong>offer</strong> to purchase. The
          contract is formed only when we confirm acceptance via order
          confirmation and successful payment capture. We reserve the right to
          decline or cancel any order at our discretion — refunds will be issued
          in full if we do so.
        </p>
      </Clause>

      <Clause n="1.04" title="The container deposit">
        <p>
          Several of our oils ship in reusable glass or steel containers. A{' '}
          <strong>refundable security deposit</strong> per container is charged
          at checkout and clearly itemised on your invoice. This deposit:
        </p>
        <Bullets items={[
          <>is <strong>not</strong> consideration for sale of goods and is therefore not subject to GST,</>,
          'is refunded in full when the container is returned undamaged, within 90 days of receipt,',
          'may be forfeited (fully or partially) if the container is damaged, lost, or not returned within the policy window.',
        ]} />
        <Callout tone="brand">
          If a deposit is forfeited, GST then becomes payable on the forfeited
          amount. We will issue a <em>supplementary tax invoice</em> for this — no new payment is collected.
        </Callout>
      </Clause>

      <Clause n="1.05" title="Referral codes and linked dealers">
        <p>
          Sanathana Tattva operates a distribution network — your account may be
          linked to a partner dealer based on a referral code or location. This
          linkage is permanent once established and determines who fulfils your
          orders. Misuse of referral codes (self-referrals, fake accounts, bulk
          fraud) will result in account suspension.
        </p>
      </Clause>

      <Clause n="1.06" title="Reviews and submissions">
        <p>
          Reviews and ratings you submit may be displayed publicly. You grant
          us a non-exclusive, royalty-free licence to publish, edit for length,
          and use them in marketing. Don't post abusive, false, or third-party
          copyrighted content.
        </p>
      </Clause>

      <Clause n="1.07" title="Prohibited use">
        <Bullets items={[
          'Scraping, automated data collection, or reverse-engineering the platform.',
          'Reselling products commercially without an authorised dealer agreement.',
          'Submitting fraudulent payments, chargebacks, or stolen credentials.',
          'Uploading malware or attempting to disrupt service.',
        ]} />
      </Clause>

      <Clause n="1.08" title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, Gravity Traders' total liability
          for any claim arising from your use of this service is limited to the
          amount you paid for the specific order in question.
        </p>
        <p>
          We do not guarantee uninterrupted or error-free service. Pricing,
          stock, and listing errors may occur; we reserve the right to correct
          them.
        </p>
      </Clause>

      <Clause n="1.09" title="Changes to these terms">
        <p>
          We may update these terms from time to time. Material changes will be
          notified by email and posted here with an updated "Last revised" date.
          Continued use of the service after a change indicates acceptance.
        </p>
      </Clause>

      <Clause n="1.10" title="Governing law and jurisdiction">
        <p>
          These terms are governed by the laws of India. Any dispute is subject
          to the exclusive jurisdiction of the courts at <strong>Bengaluru,
          Karnataka</strong>.
        </p>
      </Clause>
    </Section>
  );
}

function PolicyPrivacy({ refEl }: { refEl: (el: HTMLElement | null) => void }) {
  return (
    <Section
      id="privacy"
      icon={Lock}
      eyebrow="Document 2"
      title="Privacy Policy"
      intro="We collect only what we need to ship your oils, process your payment, and improve the service. We do not sell your data. This policy follows India's Digital Personal Data Protection Act, 2023."
      refEl={refEl}
    >
      <Clause n="2.01" title="What we collect">
        <Bullets items={[
          <><strong>Identity:</strong> name, email, phone number, optional GSTIN.</>,
          <><strong>Delivery:</strong> address, pincode, geolocation (latitude / longitude / H3 cell) to assign the nearest dealer.</>,
          <><strong>Order &amp; payment:</strong> items purchased, totals, Razorpay payment / refund IDs. We do <strong>not</strong> store card numbers — those go directly to Razorpay.</>,
          <><strong>Account:</strong> Google sign-in identifier (if you use it), hashed password (if you use email login).</>,
          <><strong>Device:</strong> minimal browser metadata for security; <code>localStorage</code> keys for login tokens and a sound-preference flag.</>,
        ]} />
      </Clause>

      <Clause n="2.02" title="Why we collect it">
        <Bullets items={[
          'Fulfil orders, assign delivery agents, generate invoices.',
          'Verify identity at delivery handover via OTP.',
          'Notify you about order status, refunds, and service changes.',
          'Detect fraud, abuse, and policy violations.',
          'Comply with statutory record-keeping (GST and tax filings).',
        ]} />
      </Clause>

      <Clause n="2.03" title="Who we share it with">
        <Bullets items={[
          <><strong>Razorpay</strong> — for payments and refunds.</>,
          <><strong>Resend</strong> — for transactional emails (verification, invoices, delivery alerts).</>,
          <><strong>Firebase (Google)</strong> — for Google sign-in identity verification only.</>,
          <><strong>Your assigned delivery agent</strong> — gets your name, phone, and address to deliver the order.</>,
          <><strong>Statutory authorities</strong> — only when legally compelled.</>,
        ]} />
        <Callout tone="brand">
          We do not sell your data to advertisers, data brokers, or third parties for marketing.
        </Callout>
      </Clause>

      <Clause n="2.04" title="How long we keep it">
        <p>
          Order, invoice, and tax data is retained for <strong>8 years</strong>{' '}
          as required under the Income Tax Act and GST law. Account data is
          retained for as long as your account is active. On account deletion
          we anonymise personal fields but retain the tax-mandated records in
          a way that no longer identifies you personally.
        </p>
      </Clause>

      <Clause n="2.05" title="Your rights under the DPDP Act">
        <Bullets items={[
          'Access — request a copy of the data we hold about you.',
          'Correction — fix any inaccurate information.',
          'Deletion — close your account and have personal fields anonymised.',
          'Grievance — escalate to our Grievance Officer (see Section 5).',
          'Nominate — designate someone to exercise these rights on your behalf in the event of death or incapacity.',
        ]} />
        <p>
          Write to <a href="mailto:privacy@sanathanatattva.shop">privacy@sanathanatattva.shop</a>{' '}
          for any of the above. We respond within 30 days.
        </p>
      </Clause>

      <Clause n="2.06" title="Security">
        <p>
          Data is encrypted in transit (HTTPS / TLS). Authentication uses
          short-lived signed tokens; passwords are hashed using industry
          standard algorithms. We restrict internal access on a need-to-know
          basis. No system is perfectly secure — if a breach affects your
          data, we will notify you and the Data Protection Board of India per
          DPDP Act timelines.
        </p>
      </Clause>

      <Clause n="2.07" title="Children">
        <p>
          The service is not intended for users under 18. We do not knowingly
          collect personal data from children. If you believe a minor has
          created an account, write to us and we will delete it.
        </p>
      </Clause>

      <Clause n="2.08" title="Updates to this policy">
        <p>
          We will post material changes here and notify registered users by
          email at least 14 days before they take effect.
        </p>
      </Clause>
    </Section>
  );
}

function PolicyRefunds({ refEl }: { refEl: (el: HTMLElement | null) => void }) {
  return (
    <Section
      id="refunds"
      icon={RotateCcw}
      eyebrow="Document 3"
      title="Refunds, Returns &amp; Cancellation"
      intro="Food products carry special handling rules. This policy explains exactly when you can cancel, return, or be refunded — including for the refundable container deposit."
      refEl={refEl}
    >
      <Clause n="3.01" title="Cancelling an order">
        <Bullets items={[
          <><strong>Before a delivery agent accepts</strong> — cancel from the Orders page, full refund issued instantly.</>,
          <><strong>After acceptance, before packing</strong> — write to support; if granted, refund is processed within 5–7 business days.</>,
          <><strong>After "Packed" status</strong> — cancellation is no longer possible; treat as a return upon delivery if needed.</>,
        ]} />
      </Clause>

      <Clause n="3.02" title="Returns at delivery">
        <p>
          Inspect your order with the delivery agent before completing OTP
          handover. You may refuse delivery for:
        </p>
        <Bullets items={[
          'A damaged or leaking container.',
          'Tampered seals or compromised packaging.',
          'Visibly incorrect items or quantity.',
        ]} />
        <p>
          Refused items return to the dealer; a full refund (including container
          deposit) is processed within 5–7 business days.
        </p>
      </Clause>

      <Clause n="3.03" title="Quality issues post-delivery">
        <p>
          For quality complaints (off-smell, taste, suspected adulteration),
          contact us within <strong>48 hours of delivery</strong> with photos
          or video. We will investigate and, where the complaint is upheld,
          issue a full refund or replacement at our discretion.
        </p>
        <Callout tone="amber" title="Non-returnable items">
          Once a bottle has been opened and used in part, it cannot be returned
          for non-quality reasons — this is a food safety requirement, not a
          policy preference.
        </Callout>
      </Clause>

      <Clause n="3.04" title="Container deposit refund">
        <p>
          Reusable containers come with a refundable security deposit shown on
          your invoice. To get your deposit back:
        </p>
        <Bullets items={[
          'Return the container undamaged through any subsequent refill order, or arrange a pickup via support.',
          'Returns received within 90 days of the original order receive a full deposit refund.',
          'Containers with cracks, missing caps, or significant residue may receive a partial refund or none — assessed by the dealer at pickup.',
          'Deposits not redeemed within 90 days are considered forfeited; a supplementary tax invoice is issued for the GST then payable on that amount.',
        ]} />
      </Clause>

      <Clause n="3.05" title="Refund timelines &amp; method">
        <Bullets items={[
          <><strong>Original payment method</strong> (UPI / cards / net banking): 5–7 business days via Razorpay after we initiate the refund.</>,
          <><strong>Store credit</strong>: applied to your wallet instantly when chosen. Spendable on any future order.</>,
        ]} />
        <p>
          Bank processing times vary — if a refund hasn't reflected after 10
          business days from the date we marked it issued, send us the order
          number and we'll follow up with Razorpay on your behalf.
        </p>
      </Clause>

      <Clause n="3.06" title="How to raise a complaint">
        <Bullets items={[
          <>Email <a href="mailto:support@sanathanatattva.shop">support@sanathanatattva.shop</a> with your order number,</>,
          'Or use the in-app Support page,',
          'Or escalate to our Grievance Officer (Section 5) if unresolved within 7 days.',
        ]} />
      </Clause>
    </Section>
  );
}

function PolicyShipping({ refEl }: { refEl: (el: HTMLElement | null) => void }) {
  return (
    <Section
      id="shipping"
      icon={Truck}
      eyebrow="Document 4"
      title="Shipping &amp; Delivery"
      intro="We operate our own delivery fleet through partner dealers — no third-party couriers, no anonymous handoffs. Here's how it works."
      refEl={refEl}
    >
      <Clause n="4.01" title="Where we deliver">
        <p>
          We currently serve select pincodes across <strong>Karnataka, Tamil Nadu,
          Andhra Pradesh, Telangana, and Kerala</strong>. Enter your pincode at
          checkout to confirm coverage. Coverage expands as we onboard more
          dealers — addresses outside the network will be informed before payment.
        </p>
      </Clause>

      <Clause n="4.02" title="Delivery timelines">
        <p>
          Typical delivery is <strong>24–72 hours</strong> from order
          confirmation, depending on dealer load and distance. Festive seasons
          and weather disruptions may extend this — we'll keep you posted via
          email and in-app notifications.
        </p>
      </Clause>

      <Clause n="4.03" title="Delivery charges">
        <p>
          Delivery is <strong>free</strong> within the standard network. Custom
          delivery windows or out-of-network addresses may incur an additional
          fee that will be shown at checkout — never added silently after.
        </p>
      </Clause>

      <Clause n="4.04" title="OTP verification at handover">
        <p>
          For your safety and ours, the delivery agent will ask you for a
          six-digit OTP sent to the phone number on your order before handing
          over the items. This:
        </p>
        <Bullets items={[
          'Confirms the goods reached the right person.',
          'Prevents wrongful "delivered" marks on our system.',
          'Triggers the warranty / return window for your order.',
        ]} />
        <p>
          Don't share the OTP until the agent is at your door with the order in
          hand.
        </p>
      </Clause>

      <Clause n="4.05" title="Failed deliveries">
        <p>
          If we cannot deliver — recipient unavailable, address unreachable, or
          OTP unverified — we attempt delivery up to <strong>two more times</strong>.
          After the third failed attempt, the order returns to the dealer; a
          re-attempt fee may apply for re-dispatch. Refunds for failed
          deliveries follow Section 3.
        </p>
      </Clause>

      <Clause n="4.06" title="Address accuracy">
        <p>
          You are responsible for providing an accurate, complete delivery
          address with a working phone number. Costs from incorrect addresses
          (e.g. extra fuel, re-dispatch) may be charged at our discretion.
        </p>
      </Clause>
    </Section>
  );
}

function PolicyGrievance({ refEl }: { refEl: (el: HTMLElement | null) => void }) {
  return (
    <Section
      id="grievance"
      icon={ShieldCheck}
      eyebrow="Document 5"
      title="Grievance &amp; Contact"
      intro="Under India's IT Rules 2021 and Consumer Protection (E-Commerce) Rules 2020, every online platform must publish the contact details of a designated officer who handles complaints. Ours is below."
      refEl={refEl}
    >
      <Clause n="5.01" title="Grievance Officer">
        <div className="rounded-xl bg-gradient-to-br from-brand-50 to-parchment-200 border border-brand-200/60 p-5">
          <p className="text-[11px] uppercase tracking-wider text-brand-700 font-semibold mb-2">Designated Officer</p>
          <p className="text-lg font-semibold text-brand-900">Bharathi B N</p>
          <p className="text-sm text-slate-600 mb-4">Proprietor &amp; Grievance Officer, Gravity Traders</p>
          <div className="space-y-1.5 text-sm text-slate-700">
            <p className="flex items-center gap-2">
              <Mail size={14} className="text-brand-700" />
              <a href="mailto:grievance@sanathanatattva.shop" className="text-brand-700 hover:underline">grievance@sanathanatattva.shop</a>
            </p>
            <p className="flex items-center gap-2">
              <Phone size={14} className="text-brand-700" />
              <a href="tel:+919972922415" className="text-brand-700 hover:underline">+91 99729 22415</a>
              <span className="text-slate-500">· Mon–Sat, 10 AM – 6 PM IST</span>
            </p>
            <p className="flex items-start gap-2">
              <MapPin size={14} className="text-brand-700 mt-0.5" /> 164/1A, Halekatte, Kachihalli Village, Mayasandra, Turuvekere Taluk, Tumkur — 572227, Karnataka
            </p>
          </div>
        </div>
      </Clause>

      <Clause n="5.02" title="Response timelines">
        <Bullets items={[
          'Acknowledgement within 48 hours of receipt.',
          'Resolution within 30 days for most issues; complex cases extended with a status update.',
          'Refund-related queries resolved per the timelines in Section 3.',
        ]} />
      </Clause>

      <Clause n="5.03" title="FSSAI consumer grievance redressal">
        <p>
          As a food business operator, we are also reachable through the
          FSSAI's <strong>Food Safety Connect</strong> platform for any food
          safety concerns. You can scan the QR code printed on the packaging
          or visit{' '}
          <a href="https://foscos.fssai.gov.in/consumergrievance/" target="_blank" rel="noopener noreferrer">
            foscos.fssai.gov.in/consumergrievance
          </a>.
        </p>
      </Clause>

      <Clause n="5.04" title="Escalation">
        <p>
          If the grievance officer cannot resolve your concern within 30 days,
          you may escalate to the National Consumer Helpline (1915) or the
          relevant Consumer Disputes Redressal Commission. We will cooperate
          with any such proceedings.
        </p>
      </Clause>

      <Clause n="5.05" title="General customer support">
        <p>
          For non-grievance enquiries — order help, product questions, dealer
          onboarding — write to{' '}
          <a href="mailto:support@sanathanatattva.shop">support@sanathanatattva.shop</a>{' '}
          or use the in-app Support page. Our team aims to reply within one
          business day.
        </p>
      </Clause>
    </Section>
  );
}

# Product

## Register

brand

## Users

South Indian household cooks (primarily the woman of the house, 28-55) who buy cooking oil weekly to monthly, currently using either supermarket refined oils or a single trusted local brand. They are skeptical of supermarket FMCG, attracted to "traditional" claims but burned by greenwashed versions of them. Decision context: weekday evening on a phone after seeing the brand via a WhatsApp forward, an Instagram reel, or a neighbour's recommendation. Job-to-be-done: verify in under 30 seconds that this is real cold-pressed oil from a real family operation, not another marketing exercise, then place a first order.

## Product Purpose

Sanathana Tattva is a direct-to-consumer cold-pressed oil business operating across Karnataka, Tamil Nadu, Andhra Pradesh, Telangana, and Kerala. The platform exists to compress the trust gap between a centuries-old wooden-ghani extraction process and an online buying experience. Success on the landing page is a first-time visitor who feels the brand is honest and human within seconds, scrolls to the end of the story, and either creates an account or continues as guest to the shop.

## Brand Personality

Warm. Family-run. Honest. The voice is the founder's mother explaining how the oil is made, not a brand consultant's deck. Confident but never grandiose. No sales pressure, no superlatives, no FMCG packaging-talk. Sanskrit-rooted name is owned quietly, never spectacled.

## Anti-references

Three failure modes the page must NOT resemble:

1. **Generic AI-coded landing.** Cream background, tracked-uppercase eyebrows above every section ("EST. TRADITION", "ABOUT", "PROCESS"), 01/02/03 numbered scaffolding, identical icon-and-heading card grids, glassmorphism, faux-serif hero on warm-neutral bg. The current Landing.tsx is several steps into this trap; the rebuild must break out of it.
2. **Patanjali / typical Indian FMCG.** Saffron-dominant, banner-stacked sale callouts, badge clutter, dense product-grid landing, cluttered hero with three CTAs and four trust seals. The supermarket-shelf-online aesthetic.
3. **Pastel D2C wellness (Shopify / Notion-store).** Lifestyle-photo hero with model holding bottle, soft pastel cards, ingredient-callout grid with watercolor leaves, "clean / pure / mindful" Instagram-bio voice.

## Design Principles

1. **Show the press.** The wooden ghani, the bullock walking the circle, the oil pooling, the bottle being filled. The literal process IS the brand. Story scrolls past the visitor as if they're watching the oil being made. Never abstract this into icons.
2. **Heritage without cosplay.** Traditional cues (devanagari numerals, ghani art, the Sanskrit name) are present but never costumed. No saffron-and-tulsi visual vocabulary. The page should feel like a contemporary family business that happens to make oil the old way, not a heritage museum exhibit.
3. **Trust before delight.** The first 5 seconds must read as "this is a real operation run by real people." Aesthetic polish comes second. If a visual flourish would make a skeptical viewer wonder if the operation is real, cut it.
4. **Move with the oil.** Motion is viscous, slow, intentional. Easing curves bias toward exponential-out. No bounce, no spring overshoot. The page scrolls like pouring honey, not like a SaaS landing.
5. **Family voice.** Copy is in plain, specific, slightly conversational English. Names of family members can appear. No "we believe in", no "our journey", no "transform your kitchen".

## Accessibility & Inclusion

Target WCAG 2.1 AA. The audience skews mobile-first, includes older users (45-55+), and many will read in Indian English as a second or third language. Body copy at minimum 16px / 1.5 line-height; ≥4.5:1 contrast on all text. `prefers-reduced-motion` honoured by every animation: viscous scroll story collapses to a clean linear fade-in. Touch targets ≥44px. Hindi/Kannada/Tamil tooltips for product names where helpful (deferred; English-first for v1).

# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Sales AITO
**Generated:** 2026-09-17 15:38:03
**Category:** AI/Chatbot Platform
**Design Dials:** Variance 7/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 4/10 (Standard)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Dark Canvas | `#0B0D17` | `--marketing-canvas-dark` |
| Dark Surface | `#131727` | `--marketing-surface-dark` |
| Dark Elevated | `#1B2033` | `--marketing-surface-elevated` |
| Text on Dark | `#F7F8FC` | `--marketing-text-on-dark` |
| Muted on Dark | `#AEB7CC` | `--marketing-muted-on-dark` |
| Border on Dark | `#30374E` | `--marketing-border-on-dark` |
| Action / Success | `#B7FF5A` | `--marketing-action` |
| On Action | `#101410` | `--marketing-on-action` |
| AI Accent | `#7C6DFF` | `--marketing-ai-accent` |
| Light Canvas | `#F5F7FB` | `--marketing-canvas-light` |
| Light Surface | `#FFFFFF` | `--marketing-surface-light` |
| Text on Light | `#171A2B` | `--marketing-text-on-light` |
| Muted on Light | `#5E667C` | `--marketing-muted-on-light` |
| Border on Light | `#DDE2EC` | `--marketing-border-on-light` |
| Destructive | `#C92A38` | `--marketing-destructive` |
| Focus Ring | `#B7FF5A` | `--marketing-focus` |

**Color Notes:** The user-approved Autonomous Command direction takes precedence over the generated purple/cyan default. Lime is reserved for primary action, success, and active automation; violet indicates AI orchestration and must not replace status text.

### Typography

- **Heading Font:** Space Grotesk
- **Body Font:** DM Sans
- **Mood:** tech, startup, modern, innovative, bold, futuristic
- **Google Fonts:** [Space Grotesk + DM Sans](https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap)

Use `next/font/google` or self-hosted font files. Do not add a render-blocking CSS `@import`.

### Spacing Variables

*Density: 4/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button — illustrative; production CSS uses marketing tokens. */
.btn-primary {
  background: var(--marketing-action);
  color: var(--marketing-on-action);
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: var(--marketing-text-on-dark);
  border: 1px solid var(--marketing-border-on-dark);
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: var(--marketing-surface-light);
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
}

.card[data-interactive="true"]:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: var(--marketing-ai-accent);
  outline: 3px solid var(--marketing-focus);
  outline-offset: 2px;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** AI-Native UI

**Keywords:** Chatbot, conversational, voice, assistant, agentic, ambient, minimal chrome, streaming text, AI interactions

**Best For:** AI products, chatbots, voice assistants, copilots, AI-powered tools, conversational interfaces

**Key Effects:** Static workflow context cards, restrained violet ambient light, and optional progressive-enhancement reveals. Do not simulate typing or stream text merely as decoration.

### Page Pattern

**Pattern Name:** Conversion-first Autonomous Operator

- **Conversion Strategy:** Explain value with a lightweight product workflow mockup and verifiable current capabilities. Use verified proof only when it exists; never fabricate logos, testimonials, or usage counts.
- **CTA Placement:** Start free and demo in the hero, pricing, and final section without a sticky mobile obstruction.
- **Section Order:** Header > Hero > Current proof > Order lifecycle > AITO at work > Integrations > Use cases/trust > Pricing preview > FAQ > Final CTA > Footer.

---

## Motion

Use CSS transitions of 150–220ms for hover, focus, disclosure, and navigation state. Optional scroll reveals must be progressive enhancement: all content is visible in initial HTML/CSS without JavaScript. Do not add GSAP for the first release. Under `prefers-reduced-motion: reduce`, remove non-essential transforms and transitions.

---

## Anti-Patterns (Do NOT Use)

- ❌ Heavy chrome
- ❌ Slow response feedback

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Misleading affordances** — Only interactive elements receive pointer cursors and hover elevation
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons use one consistent SVG language
- [ ] Only interactive elements use pointer cursors and action hover states
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile

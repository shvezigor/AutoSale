# Guided workspace onboarding

**Status:** Available

## Purpose

The `Onboarding` workspace page is the single launch checklist for a newly created Sales AITO workspace. It shows real configuration state and routes the owner to existing settings forms. It does not duplicate integration forms or store a separate onboarding completion flag.

## User flow

1. The owner opens `Onboarding` from the primary navigation.
2. Sales AITO reads current catalogue, Instagram, order-rule, delivery, supplier, notification and commercial settings.
3. The page separates the three required launch steps from four optional integrations.
4. The main action opens the first incomplete required step in the exact Settings tab.
5. After the owner saves settings and returns, progress is recalculated from the canonical configuration.
6. When all required steps are ready, the main action opens Orders. Optional integrations remain available and do not block work.

## Readiness rules

### Required

- **Product catalogue:** at least one catalogue source has `ACTIVE` status.
- **Customer channel:** the Instagram connection has `ACTIVE` status.
- **Order rules:** the order settings API returns both intent detection and approval modes. Safe defaults therefore count as ready, while a missing or inaccessible configuration does not.

### Optional

- **Delivery:** at least one Nova Poshta, Meest or Ukrposhta connection is active and has sender details.
- **Suppliers:** the selected Telegram destination still exists in the available destination list.
- **Notifications:** a personal Telegram binding is connected.
- **Payment details:** an active bank account belongs to an active legal entity.

Optional steps use `Optional` while incomplete and `Ready` when configured. They never reduce required-step progress.

## Interface contract

- Desktop uses a compact checklist with a contextual next-action panel.
- Mobile uses a single-column layout with the next action before the checklist.
- Every step is a real link and remains keyboard accessible.
- The progress indicator has accessible `progressbar` semantics and numeric values.
- Shared `primary-button` and `text-button` variants are mandatory.
- The page is localized in Ukrainian and English.
- Provider/API failures degrade to an incomplete state instead of replacing the page with demo data or crashing the entire checklist.

## Non-scope

- The page does not embed or recreate Settings forms.
- It does not force a linear modal tour.
- It does not persist skipped optional steps.
- It does not change provider authorization, order processing or role permissions.

## Verification

- Unit tests cover status derivation, required progress, optional non-blocking behavior, Settings deep links and both locales.
- Browser verification covers desktop and mobile composition, keyboard focus order and the absence of horizontal overflow.

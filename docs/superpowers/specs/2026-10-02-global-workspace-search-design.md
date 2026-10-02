# Global workspace search

**Status:** Available

## Purpose

Replace the decorative workspace-header search with a tenant-scoped command palette that helps an owner or manager find customers, orders and catalogue products without first choosing a section.

## User flow

1. The user clicks the header search or presses `Ctrl+K` / `Command+K`.
2. A search dialog opens and focuses its input.
3. After at least two non-whitespace characters, Sales AITO waits briefly and requests grouped results.
4. The dialog shows up to five customers, five orders and five products, with loading, empty and recoverable error states.
5. Arrow keys move through results, `Enter` opens the active result and `Escape` closes the dialog and restores focus to the trigger.
6. Selecting an order opens its detail page. Selecting a product opens the catalogue filtered by its SKU. Selecting a customer opens orders filtered by the customer's phone, username or name.

## API contract

`GET /api/search?q=<query>&limit=<1..10>` requires an authenticated workspace membership with at least `MANAGER` access.

The response contains:

- `query`: the normalized query;
- `customers`: stable customer result keys, display name, phone/username context and a filtered-orders URL;
- `orders`: order ID, readable order number, customer name, product summary, status and detail URL;
- `products`: catalogue product ID, SKU, name, price/currency, stock and filtered-catalogue URL.

The query is trimmed, limited to 100 characters and must contain at least two characters. The response limit defaults to five per group. The API returns no raw provider payloads, message bodies or credentials.

## Data and isolation

- Search executes only under the current authenticated tenant authority.
- Existing tenant-scoped order and catalogue search behavior remains canonical; the aggregator does not introduce a second customer, order or product store.
- Customer results are deduplicated from matching tenant orders because Sales AITO does not currently own a separate customer master record.
- Customer identity prefers phone, then Instagram username, then normalized name. The displayed fallback never exposes an internal UUID.
- The initial implementation does not add a new database index. The stable API boundary allows PostgreSQL trigram/full-text indexing later without changing the UI.
- Results are bounded and fetched in parallel. A failure in one source does not leak partial technical errors; the whole request returns a safe service failure that the UI can retry.

## Interface contract

- The existing header position and visual language remain unchanged.
- Desktop uses an anchored command dialog; mobile uses a viewport-safe full-width sheet.
- The trigger is a real button, uses the localized placeholder and advertises its keyboard shortcut.
- The dialog follows accessible dialog/combobox/listbox semantics, has a visible label, traps neither the browser nor screen-reader cursor unnecessarily, and restores focus on close.
- Results have textual group labels and type labels; colour is never the only identifier.
- Search is localized in Ukrainian and English.
- The empty query shows a short instruction, not stale results.
- No-results and provider-failure states remain distinct.

## Non-scope

- Searching message contents, settings, team members or public marketing pages.
- Fuzzy semantic or AI search.
- A dedicated customer profile page.
- Cross-tenant platform-admin search.
- Persisting search history or analytics in the first release.

## Verification

- API tests cover validation, permissions, tenant propagation, grouping, customer deduplication, bounded results and safe failures.
- Component tests cover click and shortcut opening, debounce, rendering, keyboard selection, navigation, retry, empty state, close/focus restoration and both locales.
- Browser acceptance covers desktop and mobile composition, keyboard operation, exact navigation destinations and absence of horizontal overflow.

The shipped implementation is owned by `packages/contracts/src/search.ts`, `apps/api/src/search`, `apps/web/src/api/workspace-search.ts` and `apps/web/src/components/workspace-search.tsx`. Automated contract, API and component tests protect the public response shape, tenant-scoped aggregation and keyboard-accessible interface.

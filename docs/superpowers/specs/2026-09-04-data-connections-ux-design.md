# AutoSale data connections UX

## Goal

Make catalogue import and order export feel like two simple business actions instead of infrastructure configuration. Owners choose a source, AutoSale does the technical work, and manual review appears only when the system cannot make a safe decision.

## Information architecture

Rename the Google settings tab to **Data** (`Дані`) with the description `Товари й експорт`. The page contains two task cards:

1. **Товари** — choose a Google Sheet or upload CSV/XLSX. The catalogue page remains the place to browse and edit imported products, not configure sources.
2. **Експорт замовлень** — choose a Google spreadsheet and sheet where approved orders are written.

The standalone Google account card is removed from the normal happy path. Account state is shown as compact contextual information inside the relevant action.

## Google authorization

Google Sign-In continues to request only identity scopes. Access to Drive is requested progressively when the owner first clicks **Обрати Google-таблицю**.

- If the tenant already has an active Google connection, open Google Picker immediately.
- Otherwise, start the existing Google OAuth flow and return to `settings?tab=data&action=pick-catalogue` or `action=pick-orders`.
- After callback, the page resumes the intended Picker action automatically.
- Request only `drive.file`; AutoSale can access files selected or created through the application, not the whole Drive.
- Managers can see health/status but cannot authorize, select, or inspect tenant data.

This keeps registration low-friction and makes the first data action a single conceptual operation for the owner.

## Catalogue flow

### Google Sheets

1. Owner clicks **Обрати Google-таблицю**.
2. Progressive authorization runs only if needed.
3. Google Picker returns a spreadsheet.
4. AutoSale loads sheet tabs; if there is one usable tab, it is selected automatically. Multiple tabs are shown as a small choice.
5. Saving the choice creates or updates the tenant catalogue source and starts analysis/import.

### CSV/XLSX

1. Owner clicks **Завантажити файл**.
2. The selected file enters the same analysis/import pipeline as Google Sheets.
3. No visit to the catalogue page is required to finish onboarding.

### Automatic decision

Auto-import when all conditions hold:

- exactly one source column maps to product name with high confidence;
- no two source columns map to the same canonical field;
- required product names are present in valid data rows;
- SKU values, when supplied, are structurally valid and non-conflicting;
- changed headers do not produce a materially different or uncertain semantic mapping.

SKU is optional. When absent, AutoSale creates a stable SKU. Price and stock are optional.

When safe, the UI skips preview and shows a completion summary: created, updated, skipped, and failed row counts.

When any condition is uncertain, the run becomes `REVIEW_REQUIRED`. The UI shows only questionable mappings, the reason for review, and a five-row sample. The owner can correct mappings and import.

The previous valid catalogue remains active until a new import completes successfully.

## Order export flow

1. Owner clicks **Обрати таблицю для замовлень**.
2. Progressive authorization and Picker work as above.
3. Owner chooses a sheet tab.
4. AutoSale validates required columns.
5. If the chosen tab is empty, AutoSale creates the canonical headers. Existing non-empty incompatible data is never overwritten; the UI asks the owner to choose another tab or explicitly create a new `AutoSale Orders` tab.
6. The card shows connection status, destination, last successful export, and actionable errors.

## UI direction

The page uses the existing AutoSale palette and typography so it remains coherent with the product. The distinctive element is a compact, semantic progress rail (`Обрано → Розпізнано → Готово`) that appears only while work is running and collapses into a result summary afterward.

Technical fields such as spreadsheet IDs, service-account instructions, credential state, and explicit connectivity checks are removed from the primary interface. Advanced destructive actions remain available through a quiet overflow/details area.

The interface must remain responsive, keyboard accessible, and compatible with reduced-motion preferences.

## API and state changes

- Reuse existing Google OAuth, Picker, source, import, and order destination APIs where possible.
- Add a deterministic mapping decision function that returns `AUTO_IMPORT` or `REVIEW_REQUIRED` plus reason codes.
- Let the mapping worker confirm and execute safe mappings automatically.
- Surface the latest run state and result in the settings response so the task card can render progress or completion.
- Route CSV/XLSX uploads through the same result model.
- Preserve tenant isolation, idempotency, audit events, and encrypted refresh-token storage.

## Testing

- Unit-test mapping decisions before implementation: confident mapping, missing name, duplicate target, invalid/conflicting SKU, and safe/unsafe header changes.
- Component-test progressive Google authorization, Picker continuation, automatic completion summary, and review-only-on-uncertainty.
- Keep existing catalogue import, Google OAuth, Picker, and order export tests green.
- Add an end-to-end happy path for a Google catalogue selection and a review-required path.

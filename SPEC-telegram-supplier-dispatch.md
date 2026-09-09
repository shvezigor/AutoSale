# Telegram supplier dispatch

## Goal

Let a workspace owner select a permitted Telegram Business chat (or a bot-managed group fallback) and send an approved order to that supplier with one explicit action.

## Product rules

- AutoSale observes only chats that Telegram Business sends to the configured bot; it does not import chat history.
- Message bodies are not stored while discovering destinations. AutoSale stores only the chat identifier, display label, route, and last-observed time.
- The owner selects the supplier destination in Settings. Manual dispatch is the default.
- Only `APPROVED` and `AUTO_APPROVED` orders may be sent.
- Supplier messages contain order number, product name/SKU, quantity, size, and color. Customer phone and delivery address are excluded by default.
- Repeated clicks reuse the same idempotency key and cannot create duplicate delivery records.
- Automatic dispatch is a later opt-in enhancement and must never be enabled implicitly.

## Delivery sequence

1. Telegram sends a `business_connection` update after the owner connects AutoSale in Telegram Business settings.
2. A permitted incoming `business_message` makes the chat available as a supplier destination.
3. The owner selects that destination in AutoSale Settings.
4. On an approved order, the owner chooses **Send to supplier**.
5. AutoSale persists a `SUPPLIER_ORDER` delivery and wakes the existing Telegram delivery worker.
6. The order UI shows queued, delivered, or failed state and permits a safe retry when applicable.

## Acceptance criteria

- Unknown, disabled, or cross-tenant Business connections are ignored.
- No business message text is persisted during destination discovery.
- Only owners can configure supplier destinations.
- Only managers in the same workspace can dispatch eligible orders.
- Delivery is durable, tenant-scoped, idempotent, and uses the external Telegram Business connection ID.
- Bot-managed supplier groups remain available when Telegram Business cannot be used.

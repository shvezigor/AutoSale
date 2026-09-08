# Capability Map: Telegram supplier delivery and alerts

| Module id | Responsibility | Depends on |
|---|---|---|
| `telegram-platform` | Operate the shared AutoSale bot, verify Telegram webhooks, link Telegram identities/chats with expiring tokens, and deliver messages durably without exposing credentials | — |
| `supplier-dispatch` | Connect a Telegram Business account or supplier group, select the supplier destination, and send an approved order manually or automatically exactly once | `telegram-platform` |
| `personal-alerts` | Let each workspace member link a private Telegram chat and choose privacy-safe AutoSale event notifications | `telegram-platform` |

Build order: `telegram-platform` → `supplier-dispatch`, `personal-alerts`.

## Product boundary

- AutoSale operates one platform bot. Customers never create a bot or paste a bot token.
- Supplier delivery supports an official Telegram Business connection and a reliable group-chat fallback.
- Telegram Business may send only to chats allowed by Telegram and can require a recent incoming supplier message.
- PostgreSQL remains the source of truth. Telegram is a delivery channel, not an order store.
- Personal alerts exclude customer phone and delivery address by default. Supplier messages include only fields needed to fulfil the selected order.
- Manual supplier dispatch is the default. Automatic dispatch is an explicit owner setting and applies only to valid approved orders.


# Sales AITO Monetization Hypothesis

Date: 2026-09-17
Status: approved as an initial hypothesis for validation

## User, problem, and outcome

Sales AITO serves owners and teams of Ukrainian social-commerce businesses that need to convert customer conversations into fulfilled orders with less manual work. The business outcome is recurring subscription revenue aligned with completed operational value, while customers receive predictable costs and can add teammates without being penalized for collaboration.

Affected actors are the tenant owner, managers invited by that owner, the platform operator, and background workers that measure billable usage.

## Confirmed product facts

- The current repository has tenant, membership, conversation, message, order, catalogue, and integration models.
- It does not yet have subscription, invoice, payment, entitlement, trial, or usage-ledger models.
- PostgreSQL is the source of truth; Google Sheets is a projection.
- AI output remains untrusted until schema, catalogue, completeness, duplicate, and approval checks pass.
- Instagram, AI order recognition, manager review, catalogue management, and Google Sheets form the current product baseline.
- Other social channels, autonomous replies, postal labels, and supplier messaging are roadmap capabilities and cannot be sold as available yet.

## Pricing principle

The primary value metric is **processed orders per tenant per billing month**. Customers are not billed per AI token. User limits remain generous and visible, but order volume is the principal plan boundary because it is easier for customers to understand and more closely connected to realized value.

An order counts toward usage once when Sales AITO creates the canonical tenant order from a conversation. Edits, approval retries, export retries, duplicate webhook deliveries, and status changes do not count again. Deleted or cancelled orders remain counted for that billing period so deletion cannot manipulate usage.

## Initial plans

| Plan | Monthly price | Included processed orders | Connected sales channels | Users | Active catalogue products |
|---|---:|---:|---:|---:|---:|
| Trial | Free for 30 days | 50 | 1 | 3 | 2,000 |
| Start | 599 UAH | 300 | 1 | 3 | 2,000 |
| Growth | 1,999 UAH | 1,500 | Up to 3 available channels | 10 | 10,000 |
| Scale | 2,999 UAH | 5,000 | All available channels | 25 | 50,000 |
| Enterprise | Custom | Contracted | Contracted | Contracted | Contracted |

Only production-ready channels count as plan benefits. A plan comparison may show future capabilities in a separate roadmap section but may not imply that they are already included and usable.

Annual billing receives a 20% discount. Tax display, invoice format, accepted payment methods, and the payment provider require a separate billing implementation decision before checkout is built.

## Trial policy

- A registered account receives a setup window of up to 30 days before trial activation.
- The 30-day trial begins on the first successful activation event: connecting the first supported sales channel or completing the first catalogue import, whichever occurs first.
- No payment card is required to start the trial.
- Trial limits are visible before activation and throughout the trial.
- The tenant owner receives reminders before trial expiry.
- Trial expiry never deletes tenant data. The workspace becomes read-only except for billing, export, and account-management actions until a paid plan is selected.
- One trial is allowed per tenant. Re-registration and invitation changes do not reset it.
- Operator-approved extensions are audited and require a reason and expiry date.

## Usage and limit behavior

- Usage is tenant-scoped, idempotent, and derived from canonical orders rather than webhook or worker attempts.
- The owner sees current period, plan limit, and renewal date.
- Warnings appear at 80% and 100% of the included order allowance.
- Reaching 100% does not interrupt an order already being processed and never hides existing data.
- The initial launch does not use surprise overage charges. New order automation pauses after a small documented completion buffer, and the owner is offered an upgrade.
- Downgrades take effect at the next billing boundary. Existing records remain readable even when the new plan has lower limits.
- Upgrades may take effect immediately with a prorated charge once a payment provider is selected.

## Feature boundaries

Build now for pricing communication:

- public pricing table;
- 30-day trial explanation;
- clear plan limits and roadmap labels;
- self-service registration and sign-in links;
- analytics events for pricing views, trial starts, activation, and upgrade intent.

Validate before implementing billing enforcement:

- customer willingness to pay at 599 / 1,999 / 2,999 UAH;
- typical monthly order volume and catalogue size by segment;
- average AI and infrastructure cost per processed order;
- which features cause upgrade intent;
- preferred payment methods and need for invoices or VAT documents.

Defer until separately designed:

- payment-provider integration;
- automated recurring charges;
- invoices, refunds, taxes, and dunning;
- paid overages;
- reseller or agency accounts;
- usage billing for external provider fees such as paid Viber or carrier messages.

## Metrics and validation rule

Activation means that a tenant connects a supported sales channel or imports a catalogue and then produces its first recognized order.

Initial funnel metrics:

1. registration to activation;
2. time to activation;
3. activation to first recognized order;
4. activated trial to paid-plan intent;
5. paid-plan selection by tier;
6. direct AI and infrastructure cost per processed order;
7. plan-limit warnings and attempted over-limit actions.

For the first 20 activated trials:

- continue the pricing experiment if at least 15% produce verified paid-plan intent and projected direct service cost is at most 30% of plan revenue;
- interview activated non-converters before changing price when conversion is below 15%;
- stop selling a tier at its current limits if projected direct service cost exceeds 30% of its revenue or the tier regularly requires manual operator intervention that makes delivery unprofitable.

Because payment processing is not yet implemented, a demo request, signed pilot agreement, or explicit acceptance of the quoted plan counts as paid-plan intent during initial validation. It does not count as collected revenue.


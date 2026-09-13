# Task 3 report — in progress

## Adapter/contracts checkpoint

Implemented explicit NOVA_POSHTA/UKRPOSHTA shipment drafts, exact Ukrposhta BRANCH validation, and the opaque `up:{officeId}:{fiveDigitPostcode}` reference. The stable classifier office ID is retained independently of the label. Previously stored numeric references must be selected again before creating a shipment; display labels are never parsed for postcodes.

Added official eCom address/client/create/read/lifecycle/update/delete and forms sticker operations. JSON and PDF responses are bounded and validated. Redirects are refused, hosts are fixed by credential environment, and provider failures become bounded codes without response bodies or secrets. Ambiguous shipment POST results become UNKNOWN_CREATE and are never retried by the adapter.

`UKRPOSHTA_SANDBOX_SHIPMENTS_ENABLED` defaults false in API and worker configuration. The adapter additionally refuses production shipment creates even when sandbox creation is enabled. This is intentionally pending combined carrier acceptance.

Official contract checked against https://dev.ukrposhta.ua/uploads/API_documentation_09032026_ua.pdf: address/client sections 2–3; shipment section 4; domestic quote section 6.2; forms section 10. The document contains a side-effect-free `POST /domestic/delivery-price`, so the adapter supports an estimate with final `deliveryPrice` retained from create. Default service for this slice is STANDARD/W2W. Individual client creation uses separate first/last/middle names; sender legal-entity identity support needs an explicit profile extension rather than guessing company data.

Observed RED then GREEN: branch-reference regression; carrier draft restrictions; eCom/forms fake-boundary tests; API/worker config default and explicit enablement.

Validation at this checkpoint: 28 config tests, 29 delivery/contract tests, 46 Ukrposhta integration tests passed. Config/contracts/integrations typechecks passed. No live provider calls, shipments, pushes, deployments, or secret changes.

API/worker/UI and persistence integration are still in progress and are not represented as completed by this checkpoint.

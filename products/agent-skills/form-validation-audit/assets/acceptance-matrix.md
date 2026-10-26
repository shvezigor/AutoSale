# Form acceptance matrix

| Scenario / precondition | Expected observable result | Evidence / tool | Observed / proposed / blocked |
|---|---|---|---|
| Invalid required/format input submitted | Relevant clear feedback, valid control/group association, predictable keyboard recovery | Component + browser | |
| One field edited with two unrelated errors | Correct error lifecycle; unresolved unrelated error retained | Component + browser | |
| Cross-field dependency edited | Dependent issue re-evaluated against current values; no stale contradiction | Unit/component + browser | |
| Input changed before async response | Stale response cannot overwrite current result or attach to another row | Controlled component/integration fixture | |
| Form-level permission/conflict/provider failure | Safe non-field message unless contract supplies safe field issue; safe values retained | Contract + controlled fixture | |
| Correction and successful save | Primary task completes, explicit confirmation, persisted state after reload, downstream result | Authorized real browser | |
| Keyboard, grouping and screen reader | Usable focus/recovery and understandable associated errors without disruptive repeated announcements | Browser + actual assistive technology | |
| Narrow layout / zoom / supported locale | Errors remain readable and near relevant controls, focus remains visible | Browser at declared sizes/locales | |

Use fictional data or an explicitly authorized test account. Exclude destructive, messaging and payment effects unless authorized. Adapt or mark scenarios not applicable with reasons. Blank status cells are intentional: this is a reusable plan, not passing test evidence.

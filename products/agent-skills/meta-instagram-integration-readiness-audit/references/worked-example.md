# Fictional supplied-evidence example

Evidence M1: app uses Instagram Login, exact API version not supplied; a role tester connects. M2: “Ready for testing” indicator; business verification pending. M3: callback configured for preview.example.invalid, deployed app is app.example.invalid. M4: webhook challenge returned correctly; no signed-event evidence. M5: screencast begins after login; reviewer account not independently tried. Official docs unavailable in this fictional session.

## Example report, not Meta acceptance

Technical readiness: blocked/partial. The callback mismatch is a concrete configuration discrepancy; its effect must be tested in the chosen environment. No claim is made about which token exchange failed because no exchange evidence was supplied.

Submission readiness: incomplete. Verify path/version-specific access requirements against official docs; test the reviewer account through the full start-to-finish flow; record login and each requested capability in the screencast. Challenge success does not verify signatures or real ingestion.

Provider approval: unverified/pending. Tester success and “Ready for testing” do not establish external-customer access. Resolve the supplied business-verification gate and confirm the applicable permission access levels. No fixed approval date or required universal permission set can be inferred.

No provider settings, account roles, credentials, messages or review submission were changed. The next action is owner verification of the exact path/version and private reviewer setup, followed by an authorized browser test.

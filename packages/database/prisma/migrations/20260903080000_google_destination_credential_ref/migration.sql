ALTER TABLE "google_sheets_destinations"
ADD COLUMN "credential_ref" UUID;

CREATE INDEX "google_sheets_destinations_credential_ref_idx"
ON "google_sheets_destinations"("credential_ref");

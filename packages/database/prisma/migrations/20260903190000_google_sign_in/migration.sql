ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

CREATE TABLE "google_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "google_subject" TEXT NOT NULL,
    "email_at_link" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "google_sign_in_attempts" (
    "id" UUID NOT NULL,
    "state_token_hash" TEXT NOT NULL,
    "return_path" TEXT NOT NULL DEFAULT '/conversations',
    "state_expires_at" TIMESTAMP(3) NOT NULL,
    "state_used_at" TIMESTAMP(3),
    "onboarding_token_hash" TEXT,
    "onboarding_expires_at" TIMESTAMP(3),
    "onboarding_used_at" TIMESTAMP(3),
    "google_subject" TEXT,
    "verified_email" TEXT,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_sign_in_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_identities_user_id_key" ON "google_identities"("user_id");
CREATE UNIQUE INDEX "google_identities_google_subject_key" ON "google_identities"("google_subject");
CREATE UNIQUE INDEX "google_sign_in_attempts_state_token_hash_key" ON "google_sign_in_attempts"("state_token_hash");
CREATE UNIQUE INDEX "google_sign_in_attempts_onboarding_token_hash_key" ON "google_sign_in_attempts"("onboarding_token_hash");
CREATE INDEX "google_sign_in_attempts_state_expires_at_state_used_at_idx" ON "google_sign_in_attempts"("state_expires_at", "state_used_at");
CREATE INDEX "google_sign_in_attempts_onboarding_expires_at_onboarding_used_at_idx" ON "google_sign_in_attempts"("onboarding_expires_at", "onboarding_used_at");

ALTER TABLE "google_identities"
ADD CONSTRAINT "google_identities_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One-time token storage — step 1.4, architecture section 4.1.
--
-- Per D8: one table for all three single-use flows, not three. Only the
-- guardian_invitation purpose is issued at this step; email_verification
-- arrives at 1.6 and password_reset at 1.8, with no further migration.
--
-- The unique index on token_hash is the one architecture section 4.8 names.
-- The user_id index is not named there, added for the same reason 1.1 added
-- one to auth_sessions: listing a user's tokens is a real query, and the
-- cascade needs it.

-- CreateEnum
CREATE TYPE "one_time_token_purpose" AS ENUM ('guardian_invitation', 'email_verification', 'password_reset');

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "purpose" "one_time_token_purpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "one_time_tokens_token_hash_key" ON "one_time_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "one_time_tokens_user_id_idx" ON "one_time_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

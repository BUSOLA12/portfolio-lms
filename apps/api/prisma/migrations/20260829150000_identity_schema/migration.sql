-- Identity schema — step 1.1, architecture section 4.1.
--
-- users, auth_sessions and guardianships. one_time_tokens is NOT here: the
-- architecture groups it under Identity, but the build plan assigns it to step
-- 1.4, which owns the invitation flow that needs it.

-- CreateEnum
-- Per D5. Not `active`: that word belongs to the visual state vocabulary.
CREATE TYPE "user_status" AS ENUM ('pending', 'enabled', 'suspended');

-- DropTable
-- The step 0.3 scratch model, which existed only to prove the UUID v7 default
-- and a timestamptz column against a real database. Step 0.3 recorded that 1.1
-- removes it. Verified empty before dropping.
DROP TABLE "scratch_probe";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(6),
    "status" "user_status" NOT NULL DEFAULT 'pending',
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardianships" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "guardian_id" UUID NOT NULL,
    "learner_id" UUID NOT NULL,
    "relationship" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardianships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "guardianships_guardian_id_idx" ON "guardianships"("guardian_id");

-- CreateIndex
CREATE INDEX "guardianships_learner_id_idx" ON "guardianships"("learner_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardianships_guardian_id_learner_id_key" ON "guardianships"("guardian_id", "learner_id");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


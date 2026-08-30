-- email_log — step 1.5, architecture section 4.6.
--
-- Rule 9: every scheduled email checks this table first. The index is the one
-- architecture section 4.8 names, and is deliberately not unique — entity_ref
-- is nullable and Postgres treats every NULL as distinct, so uniqueness would
-- stop guarding the account-level mail that has no entity at all.

-- CreateTable
CREATE TABLE "email_log" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "entity_ref" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_log_user_id_type_entity_ref_idx" ON "email_log"("user_id", "type", "entity_ref");

-- AddForeignKey
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

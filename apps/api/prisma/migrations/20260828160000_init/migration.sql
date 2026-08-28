-- Initial migration. No domain tables yet — step 1.1 begins those. This
-- migration establishes the one database-level convention that later models
-- cannot declare for themselves: the UUID v7 generator.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Project convention: every public id is a UUID v7 (CLAUDE.md rule 10).
-- Postgres has no built-in v7 generator before version 18, so define one here.
-- The high 48 bits are a millisecond timestamp from clock_timestamp(); the
-- rest is randomness from gen_random_uuid() (in core since Postgres 13). The
-- two set_bit calls stamp the version 7 nibble.
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
AS $$
BEGIN
  RETURN encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex')::uuid;
END
$$
LANGUAGE plpgsql
VOLATILE;

-- CreateTable
-- Scratch probe (step 0.3 only): proves the UUID v7 default and a timestamptz
-- column apply against a real database. Removed by step 1.1.
CREATE TABLE "scratch_probe" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scratch_probe_pkey" PRIMARY KEY ("id")
);

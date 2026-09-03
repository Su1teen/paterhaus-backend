-- Run once against the CHAT_HISTORY database (the one holding pater_classification).
-- This table is owned by the n8n/WAHA pipeline, not by Prisma, so it is not part of
-- prisma/migrations. Idempotent: safe to re-run.
--
-- 1. Manual leads store the contact email; the backend only writes the column if it exists.
ALTER TABLE pater_classification ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. chat_id is the deduplication key for manual + AI leads: it must be present and unique.
--    Inspect duplicates first (the constraint will fail if any exist):
--      SELECT chat_id, COUNT(*) FROM pater_classification GROUP BY chat_id HAVING COUNT(*) > 1;
ALTER TABLE pater_classification ALTER COLUMN chat_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pater_classification_chat_id_key ON pater_classification (chat_id);

-- 3. lead_type now means PROPERTY TYPE. Remap legacy identity values written by older prompts.
UPDATE pater_classification
SET lead_type = 'Other'
WHERE LOWER(BTRIM(COALESCE(lead_type, ''))) IN ('', 'owner', 'guest', 'partner', 'unknown');

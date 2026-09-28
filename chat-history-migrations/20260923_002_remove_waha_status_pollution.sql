-- One-time cleanup for the historical WAHA Status ingestion bug. This touches
-- only blank-chat/status artifacts and raw technical attachment summaries.

DELETE FROM pater_attachments
WHERE BTRIM(COALESCE(chat_id, '')) = ''
   OR LOWER(COALESCE(waha_message_id, '')) LIKE '%status@broadcast%'
   OR LOWER(COALESCE(file_name, '')) LIKE '%status@broadcast%';

DELETE FROM hostory_pater
WHERE BTRIM(COALESCE(chat_id, '')) = '';

DELETE FROM pater_ai_escalations
WHERE BTRIM(COALESCE(chat_id, '')) = '';

DO $$
BEGIN
  IF to_regclass('pater_classification') IS NOT NULL THEN
    DELETE FROM pater_classification
    WHERE BTRIM(COALESCE(chat_id, '')) = '';
  END IF;
END $$;

DELETE FROM chats_pater
WHERE BTRIM(COALESCE(chat_id, '')) = ''
  AND BTRIM(COALESCE(number, '')) = '';

UPDATE pater_attachments
SET summary = NULL
WHERE summary IS NOT NULL
  AND (
    LOWER(summary) LIKE '%<?xml%'
    OR LOWER(summary) LIKE '%<w:document%'
    OR LOWER(summary) LIKE '%xmlns:%'
    OR LOWER(summary) LIKE '%schemas.microsoft.com%'
    OR LOWER(summary) LIKE '%wordprocessingml%'
  );

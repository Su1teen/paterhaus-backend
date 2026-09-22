CREATE TABLE IF NOT EXISTS pater_attachments (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  history_id BIGINT NULL,
  waha_message_id TEXT NOT NULL,
  waha_session TEXT NOT NULL,
  sender_type TEXT NOT NULL DEFAULT 'contact',
  sender_name TEXT NULL,
  number TEXT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NULL,
  file_kind TEXT NOT NULL,
  size_bytes BIGINT NULL,
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  caption TEXT NULL,
  summary TEXT NULL,
  extracted_text TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pater_attachments_file_kind_check
    CHECK (file_kind IN ('image', 'audio', 'pdf', 'word', 'spreadsheet', 'text', 'other'))
);

CREATE INDEX IF NOT EXISTS pater_attachments_chat_id_idx
  ON pater_attachments (chat_id);
CREATE INDEX IF NOT EXISTS pater_attachments_history_id_idx
  ON pater_attachments (history_id);
CREATE INDEX IF NOT EXISTS pater_attachments_created_at_idx
  ON pater_attachments (created_at DESC);
CREATE INDEX IF NOT EXISTS pater_attachments_file_kind_idx
  ON pater_attachments (file_kind);
CREATE UNIQUE INDEX IF NOT EXISTS pater_attachments_waha_object_uidx
  ON pater_attachments (waha_session, waha_message_id, storage_key);

CREATE TABLE IF NOT EXISTS pater_ai_escalations (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_summary TEXT NOT NULL,
  requested_action TEXT NULL,
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'open',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  telegram_message_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ NULL,
  resolved_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS pater_ai_escalations_chat_id_idx
  ON pater_ai_escalations (chat_id);
CREATE INDEX IF NOT EXISTS pater_ai_escalations_status_idx
  ON pater_ai_escalations (status);
CREATE INDEX IF NOT EXISTS pater_ai_escalations_created_at_idx
  ON pater_ai_escalations (created_at);
CREATE INDEX IF NOT EXISTS pater_ai_escalations_priority_idx
  ON pater_ai_escalations (priority);
CREATE UNIQUE INDEX IF NOT EXISTS pater_ai_escalations_open_reason_uidx
  ON pater_ai_escalations (chat_id, reason_code)
  WHERE status = 'open';

# Live Paterhaus conversations

## Architecture and database boundary

```text
n8n / WAHA
  -> external PostgreSQL (chats_pater, hostory_pater)
  -> paterhaus-backend
  -> Prestige CRM
```

The backend is the only application layer that connects to the external conversation database. Prisma
continues to use the existing `DATABASE_URL`; the dedicated `pg` pool uses
`CHAT_HISTORY_DATABASE_URL`. No external-table schema migration is required or performed.

Every history lookup and latest-message association uses canonical `chat_id`. The `number` column is
display data and must never be used as a join key. n8n must write the same canonical `chat_id` into
`chats_pater.chat_id` and every related `hostory_pater.chat_id`.

## Railway variables

Set these on the **paterhaus-backend Railway service**:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Existing Prisma-managed Paterhaus application database. Do not change it for this feature. |
| `CHAT_HISTORY_DATABASE_URL` | Separate PostgreSQL database that contains `chats_pater` and `hostory_pater`. |
| `CRM_JWT_SECRET` | At least 32 random characters, used only for short-lived conversation JWTs. |
| `CRM_ALLOWED_EMAILS` | Comma-separated normalized allowlist, currently `info@paterhaus.com,r_tszi@paterhaus.com`. |
| `CORS_ORIGIN` | Local and any additional explicit CRM origins; no wildcard production origins. |
| `N8N_OUTBOUND_WEBHOOK_URL` | Optional. Protected n8n webhook that relays human takeover replies to WAHA. Manual replies stay disabled while it is unset. |
| `N8N_OUTBOUND_WEBHOOK_TOKEN` | Optional. Sent as `Authorization: Bearer …` to that webhook. |
| `LEAD_CLASSIFICATIONS_TABLE` | Optional. Pins the AI lead-classification table name in the chat-history database instead of resolving it from its column signature. |

No secrets are committed. Local implementation did not apply Railway variables or deploy either service.

The access-token endpoint is a temporary bridge: the CRM currently authenticates locally in the browser,
so the backend normalizes the submitted email, checks the allowlist, and returns a feature-scoped 15-minute
JWT. It must be replaced by verified server-side authentication when that becomes available.

## n8n data contract

- Treat `chat_id` as the canonical immutable conversation identity.
- Write history rows with exactly the same `chat_id` as their `chats_pater` row.
- Write future `hostory_pater.time` values in Asia/Almaty local time using
  `YYYY-MM-DD, HH24:MI:SS.MS`.
- Existing `YYYY-MM-DD, HH24:MI` values remain supported.
- The backend preserves every raw time string and returns a normalized ISO timestamp only when parsing is
  unambiguous and valid.
- AI rows are identified case-insensitively when `username` is `ai`.

## Phase 1 scope

Included: conversation list, ordered history, polling support, and AI takeover/resume state updates.

## Phase 2 scope

Included: explicit failure states for the external database (503 instead of an empty history), human
takeover replies through the protected n8n webhook, a capability probe, and read-only AI lead
classifications for the Owner Pipeline.

Out of scope: attachments and media processing (no upload path exists through backend → n8n → WAHA, so
the capability is reported as `false` and the CRM shows no attachment control), direct WAHA calls from the
backend or browser, and changes to the external database schema.

### Human takeover replies

```text
POST /api/paterhaus/conversations/:conversationId/messages
Authorization: Bearer <conversation access token>
Idempotency-Key: <optional client key>
{ "text": "message text" }
-> 201 { "message": { "id", "chatId", "senderName", "senderType", "direction", "text", "timeRaw", "sentAt" } }
```

| Status | Cause |
| --- | --- |
| 400 | Missing/blank/oversized text, or a non-positive conversation id. |
| 401 | Missing, invalid, or expired bearer token. |
| 403 | Valid token whose account is not allowlisted. |
| 404 | Conversation id not present in `chats_pater`. |
| 409 | AI is still enabled for the conversation, or the same idempotency key is in flight. |
| 422 | Conversation has no canonical `chat_id`. |
| 503 | Manual replies not configured, outbound delivery failed, or the chat-history database is unavailable. |

Order of operations: verify auth → verify conversation and canonical `chat_id` → verify AI is disabled →
send through n8n → insert into `hostory_pater` as `human:<authorized email>`. A failed downstream send
therefore never persists a message. Repeated `Idempotency-Key` values return the first stored message for
10 minutes instead of sending twice.

n8n must expose a webhook that accepts `{ conversationId, chatId, number, text, sentBy, idempotencyKey }`,
sends the text to the WAHA chat identified by `chatId`, and responds 2xx only after WAHA accepted it. WAHA
credentials stay in n8n. The webhook should treat `Idempotency-Key` as a de-duplication key.

`GET /api/paterhaus/conversations/capabilities` returns `{ manualMessages, attachments, maxMessageLength }`
so the CRM hides the composer entirely instead of offering a send that cannot work.

### Lead classifications

```text
GET /api/paterhaus/lead-classifications?limit=100&cursor=0
-> 200 { "items": [...], "nextCursor": null, "supportsArchive": false }
```

Each item maps the n8n table one-to-one: `id`, `chatId`, `number`, `username`, `name`, `displayName`,
`summary`, `leadType`, `stage`, `priority`, `workType`, `createdAt`, `updatedAt`, `isActive`. Rows are sorted
by `updated_at DESC NULLS LAST, id DESC`. `isActive` is `null` and `supportsArchive` is `false` when the
deployed table has no `is_active` column — the CRM then shows no archive affordance. The table is resolved
once per process from the required columns (`chat_id`, `lead_type`, `stage`, `priority`, `work_type`,
`summary`) unless `LEAD_CLASSIFICATIONS_TABLE` pins it. No foreign key to `chats_pater` is created; `chat_id`
is the logical link.

## File summary

- `src/lib/chat-history-db.ts`: isolated external PostgreSQL pool and shutdown.
- `src/modules/conversations/conversation.auth.ts`: temporary token issuer and protected-route guard.
- `src/modules/conversations/conversation.repository.ts`: parameterized SQL and canonical `chat_id` joins.
- `src/modules/conversations/conversation.service.ts`: API mapping and contact/sender fallbacks.
- `src/modules/conversations/conversation.time.ts`: safe Asia/Almaty time normalization.
- `src/modules/conversations/conversation.routes.ts`: access-token, capabilities, list, history, manual send,
  and AI routes.
- `src/modules/conversations/conversation.outbound.ts`: protected n8n relay with timeout and safe failures.
- `src/modules/lead-classifications/*`: table discovery, read-only query, and API mapping.
- `tests/conversations.test.ts`: token, guard, ordering, AI detection, toggle, manual-send, idempotency, and
  external-database failure coverage.
- `tests/lead-classifications.test.ts`: auth, mapping, sort, `is_active` detection, and failure coverage.

## Local verification

```bash
npm run typecheck
TEST_DATABASE_URL=postgresql://paterhaus:paterhaus@localhost:5432/paterhaus_test npm test
npm run build
```

Local results:

- `npm run typecheck`: passed.
- Full test suite: 75 tests passed.
- `npm run build`: passed.

## Manual deployment checklist

### Backend service

1. Confirm `DATABASE_URL` still references the existing Prisma database.
2. Add `CHAT_HISTORY_DATABASE_URL`, `CRM_JWT_SECRET`, and `CRM_ALLOWED_EMAILS`.
2a. To enable human takeover replies, add `N8N_OUTBOUND_WEBHOOK_URL` (and `N8N_OUTBOUND_WEBHOOK_TOKEN` if
   the webhook is token-protected). Until then `GET .../capabilities` reports `manualMessages: false`.
2b. Add `LEAD_CLASSIFICATIONS_TABLE` if the classification table cannot be resolved automatically.
3. Confirm `CORS_ORIGIN` retains required local origins and any additional explicit CRM origin.
4. Deploy the backend and check `/health`.
5. Request a token with an allowed email, then verify list, history, disable, and enable routes.
6. Confirm a non-allowlisted email returns `403` and missing/invalid bearer tokens return `401`.

### Frontend service

1. Set only `VITE_PATERHAUS_API_BASE_URL` to the public backend origin.
2. Do not add database URLs, JWT secrets, WAHA keys, n8n secrets, or internal API keys.
3. Deploy after the backend is healthy.

### n8n verification

1. Confirm newly created chat and history rows share one canonical `chat_id`.
2. Insert or receive a new WhatsApp message and confirm its history ID is newer than prior messages.
3. Wait for the CRM polling interval and confirm the conversation appears newest-first.
4. Toggle takeover/resume in the CRM and confirm only `ai_enabled` changes on disable, while enable also
   refreshes `ai_resumed_at` through PostgreSQL `NOW()`.

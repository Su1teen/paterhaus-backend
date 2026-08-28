# Paterhaus Backend API

Backend API for the Paterhaus (Dubai property management) CRM. It is the source of truth for leads,
campaigns and inbound webhook events across the three business directions:

```text
Property Management
Snagging
Staging
```

Stack: Node.js · TypeScript · Fastify · Prisma · PostgreSQL · Zod · Vitest · Swagger/OpenAPI.

```text
Paterhaus React CRM frontend ─┐
                              ├─→ Paterhaus Backend API ─→ dedicated Paterhaus PostgreSQL
Paterhaus Meta connector ─────┘        (this repository)
```

The live-conversations API can read n8n/WAHA-produced rows from a separate PostgreSQL database. It does
not call n8n or WAHA. Telegram and Meta Marketing API integrations are not implemented.

---

## 1. Local setup

```bash
npm install
cp .env.example .env      # then fill in real local values
npx prisma generate
npx prisma migrate dev    # creates the schema in your local database
npm run seed              # optional: dev users + service→direction mappings
npm run dev               # http://localhost:3000
```

Useful scripts:

| Script              | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Watch-mode dev server                       |
| `npm run build`     | `prisma generate` + TypeScript build        |
| `npm run start`     | Run the compiled API from `dist/`           |
| `npm run typecheck` | TypeScript check without emitting           |
| `npm test`          | Vitest suite (needs a PostgreSQL database)  |
| `npm run seed`      | Seed dev users and integration mappings     |

## 2. Required environment variables

```env
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE

# Separate database that already contains chats_pater and hostory_pater.
CHAT_HISTORY_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/CHAT_HISTORY_DATABASE
CRM_JWT_SECRET=replace_with_at_least_32_random_characters
CRM_ALLOWED_EMAILS=info@paterhaus.com,r_tszi@paterhaus.com

WEBHOOK_SECRET=replace_with_a_long_random_secret
INTERNAL_DASHBOARD_SECRET=replace_with_another_long_random_secret

# Legacy GET connector adapter (optional). When unset/empty, GET /webhooks/meta-leads
# rejects every request with 401. Only enable for connectors that cannot send POST/Bearer.
CONNECTOR_WEBHOOK_TOKEN=replace_with_a_long_random_connector_token

CORS_ORIGIN=http://localhost:5173
```

Optional:

```env
LOG_LEVEL=info
```

All variables are validated with Zod at startup. The process fails fast (without printing values) when
`DATABASE_URL`, `CHAT_HISTORY_DATABASE_URL`, `CRM_JWT_SECRET`, `CRM_ALLOWED_EMAILS`, `WEBHOOK_SECRET`,
`INTERNAL_DASHBOARD_SECRET` or `CORS_ORIGIN` is missing.
`CONNECTOR_WEBHOOK_TOKEN` is optional — when empty, the legacy GET adapter is disabled and returns 401.

Generate strong secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Using a local PostgreSQL database

```bash
createdb paterhaus
# DATABASE_URL=postgresql://localhost:5432/paterhaus
```

Or with Docker:

```bash
docker run --name paterhaus-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=paterhaus \
  -p 5432:5432 -d postgres:16
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/paterhaus
```

The test suite uses a separate database and applies migrations automatically:

```bash
createdb paterhaus_test
TEST_DATABASE_URL=postgresql://localhost:5432/paterhaus_test npm test
```

## 4. Creating a dedicated PostgreSQL service in Railway

1. Open the Paterhaus Railway project.
2. **New → Database → Add PostgreSQL**.
3. Rename the service so it is unmistakable, e.g. `paterhaus-postgres`.

This database must be **exclusive to Paterhaus CRM**. Never point `DATABASE_URL` at the existing n8n,
WAHA or any other project database — this backend runs migrations and would alter that schema.
The default `public` schema is used because the service is dedicated.

## 5. Connecting DATABASE_URL through a Railway reference variable

In the backend service → **Variables**, add a reference variable rather than pasting a connection string:

```text
DATABASE_URL=${{paterhaus-postgres.DATABASE_URL}}
```

Substitute the actual name of the new dedicated Paterhaus PostgreSQL service (Railway's default name is
`Postgres`, giving `${{Postgres.DATABASE_URL}}`). Verify the reference resolves to the Paterhaus database
before deploying.

## 6. Prisma generate and migration commands

```bash
npx prisma generate            # regenerate the client
npx prisma migrate dev --name <change>   # create + apply a migration locally
npx prisma migrate deploy      # apply committed migrations (production)
npx prisma studio              # inspect data locally
```

`prisma db push` is not used as a deployment strategy — production always applies committed migrations.

## 7. Deploying this repository as a Railway service

1. **New → GitHub Repo → `Su1teen/paterhaus-backend`**.
2. Set the variables from section 2 (`DATABASE_URL` as the reference from section 5).
3. Railway builds with `npm ci && npm run build` and starts with
   `npx prisma migrate deploy && npm run start` (see `railway.toml`).
4. Generate a public domain under **Settings → Networking**.
5. Health check: `GET /health` (configured in `railway.toml`).

The server binds to `0.0.0.0` and uses `process.env.PORT`, so no extra Railway configuration is needed.

## 8. Setting WEBHOOK_SECRET

Railway → backend service → **Variables** → `WEBHOOK_SECRET`. Use a long random value and give the same
value to the Meta/Zapier connector as `Authorization: Bearer <WEBHOOK_SECRET>`. Rotate by updating both
sides. Never commit it.

## 9. Setting INTERNAL_DASHBOARD_SECRET

Railway → backend service → **Variables** → `INTERNAL_DASHBOARD_SECRET`. This gates the temporary webhook
monitor only, and must differ from `WEBHOOK_SECRET`.

## 10. Setting CORS_ORIGIN

Comma-separated list of allowed browser origins (no wildcards in production):

```env
CORS_ORIGIN=https://prestige-crm-production.up.railway.app
# multiple origins:
CORS_ORIGIN=https://prestige-crm-production.up.railway.app,http://localhost:5173
```

Allowed methods: `GET, POST, PATCH, DELETE, OPTIONS`. Allowed headers: `Content-Type, Authorization`.
The production Prestige CRM origin is also explicitly allowed by the application; wildcard production
origins are never enabled.

## 10a. Live Paterhaus conversations

The protected API routes are:

```text
POST  /api/paterhaus/conversations/access-token
GET   /api/paterhaus/conversations
GET   /api/paterhaus/conversations/:conversationId/messages
PATCH /api/paterhaus/conversations/:conversationId/ai
```

`CHAT_HISTORY_DATABASE_URL` is used by an isolated `pg` pool and must point to the existing database with
`chats_pater` and `hostory_pater`. It is intentionally different from `DATABASE_URL`; Prisma continues to
use only `DATABASE_URL`, and no migration is applied to the external tables.

The access-token endpoint is a temporary bridge because CRM authentication is currently frontend-local.
It issues a 15-minute feature-scoped JWT only for `CRM_ALLOWED_EMAILS`. Replace this endpoint with verified
server-side sessions when CRM authentication moves to the backend.

See [docs/live-conversations.md](docs/live-conversations.md) for the data contract, Railway variables,
n8n requirements, verification commands, and deployment checklist.

## 11. Calling GET /health

```bash
curl "https://your-api-domain/health"
```

```json
{ "status": "ok", "service": "paterhaus-backend", "timestamp": "2026-08-25T00:00:00.000Z" }
```

Returns `503` with a safe message when the database is unreachable.

## 12. Calling POST /webhooks/meta-leads

The single permanent intake endpoint for the Paterhaus Meta/Zapier connector.

```bash
curl -X POST "https://your-api-domain/webhooks/meta-leads" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -d '{
    "name": "Ivan Ivanov",
    "phone_number": "+77001234567",
    "email": "ivan@example.com",
    "property_type": "Apartment",
    "service": "Buying property"
  }'
```

```json
{ "received": true, "eventId": "uuid", "leadId": "uuid", "status": "needs_review" }
```

Authentication:

- **Preferred:** `Authorization: Bearer <WEBHOOK_SECRET>`.
- **Legacy fallback:** when no `Authorization` header is present, the endpoint also accepts
  `?key=<CONNECTOR_WEBHOOK_TOKEN>` in the query string. This is for connectors that can send a JSON body
  but cannot set custom headers. A present Bearer header always takes precedence and is validated on its
  own — the `key` fallback never rescues an invalid Bearer.
- The `key` query parameter is never written to `WebhookEvent.payload` or headers.
- Missing/invalid credentials → `401`; nothing is stored.

> **WARNING — legacy connector compatibility only.** Query-string tokens may appear in third-party/proxy
> logs and browser history. Prefer the Bearer header whenever the connector supports it, and use a
> `CONNECTOR_WEBHOOK_TOKEN` that differs from `WEBHOOK_SECRET`.

Behaviour:

- every authenticated body is stored verbatim in `WebhookEvent.payload` (unknown/future fields preserved);
- supported aliases: `name`/`full_name`, `phone_number`/`phone`/`mobile`, `email`,
  `property_type`/`propertyType`, `service`/`service_name`, `external_lead_id`/`lead_id`,
  `created_at`/`submitted_at`/`timestamp`;
- service values are translated to a direction **only** through active `IntegrationMapping` rows. Unknown
  values (e.g. `Buying property`) produce `direction = UNCLASSIFIED`, `mappingStatus = NEEDS_REVIEW` and a
  `MAPPING_REVIEW_REQUIRED` lead event — they are never guessed into `PROPERTY_MANAGEMENT`;
- a repeated `source + externalLeadId` returns `status: "duplicate"` and creates no second lead;
- errors: `400` invalid body, `401` missing/invalid secret, `500` unexpected failure. Responses never
  contain stack traces or secrets.

Other endpoints: `GET/POST /leads`, `GET/PATCH/DELETE /leads/:id`, the same shape for `/campaigns`, and
`/integrations/health`, `/integrations/webhook-events`, `/integrations/webhook-events/:id`,
`/integrations/mappings`.

`/integrations/health` reports conservatively — `n8n` and `waha` are always `not_configured` because no
real connection check exists, and connector state is inferred only from received webhook events.

## 12a. Calling GET /webhooks/meta-leads (legacy connector adapter)

A compatibility endpoint for third-party lead connectors that can **only** issue HTTP GET and cannot send
custom headers or POST bodies. The connector token is supplied through the query string:

```bash
curl "https://your-api-domain/webhooks/meta-leads?key=YOUR_CONNECTOR_WEBHOOK_TOKEN&lead_id=123&name=Ivan%20Ivanov&phone=%2B77001234567&email=ivan%40example.com&test_ref=abc"
```

```json
{ "ok": true }
```

Behaviour:

- the `key` query parameter is validated against `CONNECTOR_WEBHOOK_TOKEN` using a timing-safe comparison;
- a missing or invalid `key` returns `401` with `{ "ok": false, "error": "Unauthorized" }` and stores nothing;
- every other query parameter is stored verbatim as a `WebhookEvent` (provider `connector-get`)
  for inspection in the internal webhook monitor — **no lead is created and no downstream side effects run**;
- repeated query parameters are preserved as arrays;
- the `key` is never written to the database payload or to application logs;
- request logs for `/webhooks/` routes record only method, pathname, response status, event ID and source —
  the full query string, `key`, phone, email and raw payload are never logged.

> **WARNING — legacy/connector compatibility only.** Query-string tokens and PII (name, phone, email) may
> appear in third-party connector logs, proxy logs and browser history. Prefer
> `POST /webhooks/meta-leads` with `Authorization: Bearer <WEBHOOK_SECRET>` whenever the connector supports
> it. Use a dedicated `CONNECTOR_WEBHOOK_TOKEN` that differs from `WEBHOOK_SECRET`, and rotate it if a
> connector log is ever exposed.

A successful GET delivery appears in the internal webhook monitor
(`GET /internal/webhook-monitor?token=<INTERNAL_DASHBOARD_SECRET>`) alongside POST events, tagged with the
`connector-get` provider. The monitor lists events newest-first (with a deterministic tiebreaker on
`createdAt`), so a GET delivery landing in the same millisecond as a POST webhook still renders in a
stable order.

## 13. Opening /docs

Swagger UI: `https://your-api-domain/docs` (OpenAPI JSON at `/docs/json`). The internal monitor routes are
intentionally excluded from the docs.

## 14. Opening the temporary webhook monitor

**Temporary and private** — a server-rendered diagnostic page that will be replaced by an authenticated
Integration Console in the Paterhaus frontend.

```text
https://your-api-domain/internal/webhook-monitor?token=YOUR_INTERNAL_DASHBOARD_SECRET
```

- Event detail: `/internal/webhook-monitor/events/<eventId>?token=YOUR_INTERNAL_DASHBOARD_SECRET`
- Filters: `?page=1&limit=25&status=NEEDS_REVIEW&provider=paterhaus_meta_connector` (limit capped at 100)
- Missing/invalid token → `401`. Responses send `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`.

Do not share this URL publicly — the token is in the query string.

## 15. Security notes

- Secrets come only from Railway Variables; `.env` is git-ignored and `.env.example` holds placeholders.
- Webhook auth uses a timing-safe comparison; the expected secret is never returned or logged.
- Request logging redacts `authorization`, `cookie` and request bodies; full payloads are never logged.
  For `/webhooks/` routes the query string is dropped entirely from logs (the legacy GET adapter may carry
  the connector token and PII in the query string), and `key` is redacted everywhere else as defence in depth.
- Stored webhook headers are redacted (`authorization`, `cookie`, `x-api-key`, signature headers dropped)
  and are never returned by the API or rendered in the monitor.
- All monitor output is HTML-escaped; no environment values, database URL or stack traces are rendered.
- CORS uses the explicit `CORS_ORIGIN` list plus the explicit production Prestige CRM origin; no wildcard
  origins.
- The live-conversations routes use a short-lived feature JWT and email allowlist. Other API routes and
  the temporary monitor do not have user authentication/RBAC yet.

## 16. Removing the temporary monitor later

1. Delete `src/modules/internal/` (`monitor.routes.ts`, `monitor.view.ts`).
2. Remove the `internalMonitorRoutes` import and registration in `src/app.ts`.
3. Remove `src/utils/dashboard-auth.ts` and `src/utils/html.ts` if nothing else uses them.
4. Drop `INTERNAL_DASHBOARD_SECRET` from `.env.example` and Railway variables, and remove the monitor
   sections from `src/config/env.ts` validation and from this README.
5. Delete the monitor tests in `tests/integration-monitor.test.ts`.

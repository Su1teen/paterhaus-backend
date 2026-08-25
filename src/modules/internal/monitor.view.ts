import { escapeHtml } from '../../utils/html.js';
import type { ConnectorState, WebhookEventListRow } from '../integrations/integration.service.js';

const STYLES = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #0c0d10; color: #e6e7ea; font-size: 14px; line-height: 1.5;
  }
  a { color: #9db4ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  header { margin-bottom: 24px; }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: .01em; margin: 0 0 4px; }
  .subtitle { color: #8b8f99; font-size: 13px; }
  .badge-temp {
    display: inline-block; margin-top: 10px; padding: 3px 8px; border-radius: 4px;
    border: 1px solid #4a3a12; background: #241c08; color: #e0b64a; font-size: 11px;
    text-transform: uppercase; letter-spacing: .06em;
  }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #14161b; border: 1px solid #23262e; border-radius: 8px; padding: 14px 16px; }
  .card .label { color: #8b8f99; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; }
  .card .value { margin-top: 6px; font-size: 17px; font-weight: 600; }
  .card .hint { margin-top: 4px; color: #8b8f99; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: #14161b; border: 1px solid #23262e; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #23262e; vertical-align: top; }
  th { color: #8b8f99; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; font-weight: 600; background: #101216; }
  tr:last-child td { border-bottom: none; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: .03em; }
  .status-processed { background: #10291b; color: #62d295; border: 1px solid #1e4a31; }
  .status-needs_review { background: #2b2208; color: #e0b64a; border: 1px solid #4a3a12; }
  .status-duplicate { background: #1b2230; color: #8fb0e8; border: 1px solid #2c3a52; }
  .status-failed { background: #2c1417; color: #ef8079; border: 1px solid #542025; }
  .status-received { background: #1c1f26; color: #a9aeb9; border: 1px solid #2c313b; }
  .muted { color: #8b8f99; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  pre {
    background: #0f1115; border: 1px solid #23262e; border-radius: 8px; padding: 14px;
    overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px;
  }
  .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .filters a { padding: 4px 10px; border: 1px solid #23262e; border-radius: 6px; background: #14161b; font-size: 12px; }
  .filters a.active { border-color: #3a4a75; background: #182036; }
  .pager { display: flex; gap: 12px; align-items: center; margin-top: 14px; font-size: 12px; }
  dl { display: grid; grid-template-columns: 180px 1fr; gap: 8px 16px; margin: 0 0 24px; }
  dt { color: #8b8f99; font-size: 12px; }
  dd { margin: 0; }
  section h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .07em; color: #8b8f99; margin: 24px 0 12px; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function statusPill(status: string): string {
  const key = status.toLowerCase();
  const labels: Record<string, string> = {
    processed: 'Processed',
    needs_review: 'Needs review',
    duplicate: 'Duplicate',
    failed: 'Failed',
    received: 'Received',
  };
  return `<span class="status status-${escapeHtml(key)}">${escapeHtml(labels[key] ?? status)}</span>`;
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

const CONNECTOR_COPY: Record<ConnectorState['status'], { value: string; hint: string }> = {
  no_events_yet: { value: 'No events received yet', hint: 'Waiting for the first connector delivery' },
  receiving_events: { value: 'Receiving events', hint: 'Events are arriving and mapping cleanly' },
  needs_review: { value: 'Events need mapping review', hint: 'Unknown service values require mapping' },
  failing: { value: 'Events failing', hint: 'Recent deliveries failed during processing' },
};

export interface MonitorListView {
  token: string;
  connector: ConnectorState;
  databaseConnected: boolean;
  events: WebhookEventListRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  status?: string;
  provider?: string;
}

function buildQuery(view: MonitorListView, overrides: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  params.set('token', view.token);
  const merged: Record<string, string | number | undefined> = {
    page: view.page,
    limit: view.limit,
    status: view.status,
    provider: view.provider,
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  return `/internal/webhook-monitor?${params.toString()}`;
}

const STATUS_FILTERS = ['PROCESSED', 'NEEDS_REVIEW', 'DUPLICATE', 'FAILED', 'RECEIVED'];

export function renderMonitorList(view: MonitorListView): string {
  const connectorCopy = CONNECTOR_COPY[view.connector.status];

  const cards = `
  <div class="cards">
    <div class="card">
      <div class="label">API</div>
      <div class="value">Online</div>
      <div class="hint">paterhaus-backend</div>
    </div>
    <div class="card">
      <div class="label">Database</div>
      <div class="value">${view.databaseConnected ? 'Connected' : 'Unavailable'}</div>
      <div class="hint">Dedicated Paterhaus PostgreSQL</div>
    </div>
    <div class="card">
      <div class="label">Meta connector</div>
      <div class="value">${escapeHtml(connectorCopy.value)}</div>
      <div class="hint">${escapeHtml(connectorCopy.hint)}</div>
      <div class="hint">Last event: ${escapeHtml(formatDate(view.connector.lastEventAt))}</div>
    </div>
    <div class="card">
      <div class="label">Events last 24h</div>
      <div class="value">${escapeHtml(view.connector.eventsLast24h)}</div>
      <div class="hint">${escapeHtml(view.connector.needsReviewLast24h)} need review · ${escapeHtml(
        view.connector.failedLast24h,
      )} failed</div>
    </div>
  </div>`;

  const filters = `
  <div class="filters">
    <a href="${escapeHtml(buildQuery(view, { status: undefined, page: 1 }))}" class="${view.status ? '' : 'active'}">All</a>
    ${STATUS_FILTERS.map(
      (status) =>
        `<a href="${escapeHtml(buildQuery(view, { status, page: 1 }))}" class="${
          view.status === status ? 'active' : ''
        }">${escapeHtml(status.replace('_', ' ').toLowerCase())}</a>`,
    ).join('\n    ')}
  </div>`;

  const rows =
    view.events.length === 0
      ? `<tr><td colspan="7" class="muted">No webhook events recorded for this filter yet.</td></tr>`
      : view.events
          .map(
            (event) => `<tr>
      <td class="mono">${escapeHtml(formatDate(event.receivedAt))}</td>
      <td class="mono">${escapeHtml(event.provider)}</td>
      <td>${statusPill(event.status)}</td>
      <td>${escapeHtml(event.lead?.name ?? '—')}</td>
      <td>${escapeHtml(event.lead?.serviceRaw ?? '—')}</td>
      <td>${escapeHtml(event.lead?.direction ?? '—')}</td>
      <td><a href="/internal/webhook-monitor/events/${escapeHtml(event.id)}?token=${encodeURIComponent(
        view.token,
      )}">View</a></td>
    </tr>`,
          )
          .join('\n');

  const pager = `
  <div class="pager">
    <span class="muted">Page ${escapeHtml(view.page)} of ${escapeHtml(Math.max(view.totalPages, 1))} · ${escapeHtml(
      view.total,
    )} events</span>
    ${view.page > 1 ? `<a href="${escapeHtml(buildQuery(view, { page: view.page - 1 }))}">← Previous</a>` : ''}
    ${
      view.page < view.totalPages
        ? `<a href="${escapeHtml(buildQuery(view, { page: view.page + 1 }))}">Next →</a>`
        : ''
    }
  </div>`;

  return layout(
    'Paterhaus Webhook Monitor',
    `<header>
  <h1>Paterhaus Webhook Monitor</h1>
  <div class="subtitle">Internal diagnostics for inbound lead webhooks</div>
  <div class="badge-temp">Temporary private page</div>
</header>
${cards}
${filters}
<table>
  <thead>
    <tr><th>Received</th><th>Provider</th><th>Status</th><th>Lead</th><th>Service</th><th>Direction</th><th>Action</th></tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
${pager}`,
  );
}

export interface MonitorDetailView {
  token: string;
  event: {
    id: string;
    provider: string;
    status: string;
    receivedAt: Date;
    processedAt: Date | null;
    errorMessage: string | null;
    payload: unknown;
    lead: {
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
      propertyType: string | null;
      serviceRaw: string | null;
      direction: string;
      mappingStatus: string;
    } | null;
  };
}

export function renderMonitorDetail({ token, event }: MonitorDetailView): string {
  const lead = event.lead;
  const payloadJson = JSON.stringify(event.payload, null, 2) ?? 'null';

  return layout(
    'Paterhaus Webhook Monitor — Event',
    `<header>
  <h1>Webhook Event</h1>
  <div class="subtitle"><a href="/internal/webhook-monitor?token=${encodeURIComponent(
    token,
  )}">← Back to event list</a></div>
</header>

<section>
  <h2>Webhook metadata</h2>
  <dl>
    <dt>ID</dt><dd class="mono">${escapeHtml(event.id)}</dd>
    <dt>Provider</dt><dd class="mono">${escapeHtml(event.provider)}</dd>
    <dt>Status</dt><dd>${statusPill(event.status)}</dd>
    <dt>Received at</dt><dd class="mono">${escapeHtml(formatDate(event.receivedAt))}</dd>
    <dt>Processed at</dt><dd class="mono">${escapeHtml(formatDate(event.processedAt))}</dd>
    ${event.errorMessage ? `<dt>Error</dt><dd>${escapeHtml(event.errorMessage)}</dd>` : ''}
  </dl>
</section>

<section>
  <h2>Normalized lead</h2>
  ${
    lead
      ? `<dl>
    <dt>Name</dt><dd>${escapeHtml(lead.name ?? '—')}</dd>
    <dt>Phone</dt><dd class="mono">${escapeHtml(lead.phone ?? '—')}</dd>
    <dt>Email</dt><dd class="mono">${escapeHtml(lead.email ?? '—')}</dd>
    <dt>Property type</dt><dd>${escapeHtml(lead.propertyType ?? '—')}</dd>
    <dt>Raw service</dt><dd>${escapeHtml(lead.serviceRaw ?? '—')}</dd>
    <dt>Direction</dt><dd>${escapeHtml(lead.direction)}</dd>
    <dt>Mapping status</dt><dd>${statusPill(lead.mappingStatus)}</dd>
  </dl>`
      : '<p class="muted">No lead was created for this event.</p>'
  }
</section>

<section>
  <h2>Raw payload</h2>
  <pre>${escapeHtml(payloadJson)}</pre>
</section>`,
  );
}

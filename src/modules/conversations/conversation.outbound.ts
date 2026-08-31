import { getEnv } from '../../config/env.js';
import { serviceUnavailable } from '../../plugins/error-handler.js';

const OUTBOUND_TIMEOUT_MS = 15_000;

export interface OutboundMessageRequest {
  conversationId: number;
  chatId: string;
  number: string | null;
  text: string;
  authorizedEmail: string;
  idempotencyKey: string;
}

export interface OutboundMessageSender {
  /** Resolves only when the downstream integration confirmed a successful send. */
  send(request: OutboundMessageRequest): Promise<void>;
}

/**
 * Forwards a human takeover reply to the protected n8n webhook, which owns the
 * WAHA credentials. Neither the message text nor the webhook token is logged.
 */
class N8nOutboundMessageSender implements OutboundMessageSender {
  constructor(
    private readonly webhookUrl: string,
    private readonly webhookToken: string,
  ) {}

  async send(request: OutboundMessageRequest): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.webhookToken ? { Authorization: `Bearer ${this.webhookToken}` } : {}),
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify({
          conversationId: request.conversationId,
          chatId: request.chatId,
          number: request.number,
          text: request.text,
          sentBy: request.authorizedEmail,
          idempotencyKey: request.idempotencyKey,
        }),
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      });
    } catch {
      throw serviceUnavailable('The message could not be delivered. Please try again.');
    }

    if (!response.ok) {
      throw serviceUnavailable('The message could not be delivered. Please try again.');
    }
  }
}

/** Returns `null` when no outbound integration is configured for this deployment. */
export function createOutboundMessageSender(): OutboundMessageSender | null {
  const env = getEnv();
  if (!env.N8N_OUTBOUND_WEBHOOK_URL) return null;
  return new N8nOutboundMessageSender(
    env.N8N_OUTBOUND_WEBHOOK_URL,
    env.N8N_OUTBOUND_WEBHOOK_TOKEN,
  );
}

import type { FastifyInstance } from 'fastify';
import { getEnv } from '../../config/env.js';
import { requireConversationAccess } from '../conversations/conversation.auth.js';
import { ConversationRepository } from '../conversations/conversation.repository.js';
import { AttachmentRepository } from './attachment.repository.js';
import {
  attachmentConversationParamSchema,
  attachmentIdParamSchema,
  filesListQuerySchema,
} from './attachment.schemas.js';
import { AttachmentService } from './attachment.service.js';
import {
  createAttachmentDownloadSigner,
  type AttachmentDownloadSigner,
} from './attachment.storage.js';

export interface AttachmentRouteOptions {
  repository?: AttachmentRepository;
  conversations?: ConversationRepository;
  /** `null` explicitly simulates an unconfigured S3 integration in tests. */
  signer?: AttachmentDownloadSigner | null;
  configuredBucket?: string;
}

const attachmentTag = { tags: ['paterhaus-attachments'] } as const;

export async function attachmentRoutes(
  app: FastifyInstance,
  options: AttachmentRouteOptions,
): Promise<void> {
  const env = getEnv();
  const signer = options.signer === undefined ? createAttachmentDownloadSigner() : options.signer;
  const service = new AttachmentService(
    options.repository,
    options.conversations,
    signer,
    options.configuredBucket ?? env.ATTACHMENTS_S3_BUCKET,
  );

  app.get(
    '/api/paterhaus/conversations/:conversationId/attachments',
    {
      preHandler: requireConversationAccess,
      schema: { ...attachmentTag, summary: 'List attachment metadata for a live conversation' },
    },
    async (request) => {
      const { conversationId } = attachmentConversationParamSchema.parse(request.params);
      return service.listForConversation(conversationId);
    },
  );

  app.get(
    '/api/paterhaus/files',
    {
      preHandler: requireConversationAccess,
      schema: { ...attachmentTag, summary: 'List live Paterhaus WhatsApp attachments' },
    },
    async (request) => service.listFiles(filesListQuerySchema.parse(request.query)),
  );

  app.post(
    '/api/paterhaus/attachments/:attachmentId/download-url',
    {
      preHandler: requireConversationAccess,
      schema: { ...attachmentTag, summary: 'Create a short-lived attachment download URL' },
    },
    async (request) => {
      const { attachmentId } = attachmentIdParamSchema.parse(request.params);
      return service.createDownloadUrl(attachmentId);
    },
  );
}

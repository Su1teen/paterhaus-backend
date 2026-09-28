import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { requirePaterhausAdmin } from '../../plugins/paterhaus-auth.js';
import { badRequest, notFound, serviceUnavailable } from '../../plugins/error-handler.js';

const LIMIT = 10 * 1024 * 1024;
const allowedMime = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const uuid = z.object({ id: z.string().uuid() });
export function matchesFileType(bytes: Buffer, mime: string): boolean {
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'text/plain') return !bytes.includes(0);
  return bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
}

function storage() {
  const env = getEnv();
  if (!env.attachmentsS3Configured) throw serviceUnavailable('Private document storage is not configured');
  return { bucket: env.ATTACHMENTS_S3_BUCKET!, client: new S3Client({
    endpoint: env.ATTACHMENTS_S3_ENDPOINT, region: env.ATTACHMENTS_S3_REGION,
    credentials: { accessKeyId: env.ATTACHMENTS_S3_ACCESS_KEY_ID!, secretAccessKey: env.ATTACHMENTS_S3_SECRET_ACCESS_KEY! },
    forcePathStyle: false,
  }) };
}

export async function internalDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requirePaterhausAdmin);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: LIMIT }, (_request, body, done) => done(null, body));
  app.get('/api/paterhaus/internal-documents', async () => ({ items: await prisma.internalDocument.findMany({
    take: 100, orderBy: { createdAt: 'desc' },
  }) }));
  app.post('/api/paterhaus/internal-documents', { bodyLimit: LIMIT }, async (request, reply) => {
    const headers = z.object({ 'x-file-name': z.string().min(1).max(500), 'x-title': z.string().min(1).max(200),
      'x-category': z.string().min(1).max(80), 'content-type': z.literal('application/octet-stream'),
      'x-file-mime': z.string().min(1).max(200), 'x-description': z.string().max(2000).optional() }).parse(request.headers);
    const mime = headers['x-file-mime'].toLowerCase();
    if (!allowedMime.has(mime)) throw badRequest('File type is not permitted');
    const bytes = request.body;
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LIMIT) throw badRequest('File must be 1 byte to 10 MB');
    if (!matchesFileType(bytes, mime)) throw badRequest('File content does not match its type');
    let rawName: string;
    let title: string;
    let description: string | null = null;
    try { rawName = decodeURIComponent(headers['x-file-name']); title = decodeURIComponent(headers['x-title']);
      description = headers['x-description'] ? decodeURIComponent(headers['x-description']) : null; }
    catch { throw badRequest('Invalid document metadata'); }
    if (!title.trim() || title.length > 200 || (description && description.length > 2000)) throw badRequest('Invalid document metadata');
    const originalFileName = rawName.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180);
    if (!originalFileName) throw badRequest('Invalid filename');
    const key = `internal/${randomUUID()}`;
    const { bucket, client } = storage();
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes,
        ContentType: mime }));
      const document = await prisma.internalDocument.create({ data: {
        title: title.trim(), originalFileName, mimeType: mime, sizeBytes: bytes.length,
        storageKey: key, category: headers['x-category'], description,
        uploadedBy: request.paterhausUser!.email,
      } });
      return reply.code(201).send(document);
    } catch (error) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
      throw error;
    } finally { client.destroy(); }
  });
  app.post('/api/paterhaus/internal-documents/:id/download-url', async (request) => {
    const { id } = uuid.parse(request.params);
    const document = await prisma.internalDocument.findUnique({ where: { id } });
    if (!document) throw notFound('Document not found');
    const { bucket, client } = storage();
    try {
      const name = document.originalFileName.replace(/[\r\n"\\]/g, '_').replace(/[^\x20-\x7E]/g, '_');
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: document.storageKey,
        ResponseContentDisposition: `attachment; filename="${name}"` }), { expiresIn: 300 });
      return { url, expiresIn: 300 };
    } finally { client.destroy(); }
  });
  app.delete('/api/paterhaus/internal-documents/:id', async (request, reply) => {
    const { id } = uuid.parse(request.params);
    const document = await prisma.internalDocument.findUnique({ where: { id } });
    if (!document) throw notFound('Document not found');
    const { bucket, client } = storage();
    try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: document.storageKey })); }
    finally { client.destroy(); }
    await prisma.internalDocument.delete({ where: { id } });
    return reply.code(204).send();
  });
}

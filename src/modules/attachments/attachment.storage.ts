import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getEnv } from '../../config/env.js';

export const ATTACHMENT_DOWNLOAD_TTL_SECONDS = 300;

export interface AttachmentDownloadSigner {
  sign(input: { bucket: string; key: string; fileName: string }): Promise<string>;
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7E]|[\r\n"\\]/g, '_').slice(0, 180) || 'attachment';
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function createAttachmentDownloadSigner(): AttachmentDownloadSigner | null {
  const env = getEnv();
  if (!env.attachmentsS3Configured) return null;

  const client = new S3Client({
    endpoint: env.ATTACHMENTS_S3_ENDPOINT,
    region: env.ATTACHMENTS_S3_REGION,
    credentials: {
      accessKeyId: env.ATTACHMENTS_S3_ACCESS_KEY_ID!,
      secretAccessKey: env.ATTACHMENTS_S3_SECRET_ACCESS_KEY!,
    },
    // Railway Buckets use virtual-hosted style. Never force path-style requests.
    forcePathStyle: false,
  });

  return {
    sign: ({ bucket, key, fileName }) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: contentDisposition(fileName),
        }),
        { expiresIn: ATTACHMENT_DOWNLOAD_TTL_SECONDS },
      ),
  };
}

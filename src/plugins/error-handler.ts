import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFound(message = 'Resource not found'): HttpError {
  return new HttpError(404, message);
}

export function badRequest(message = 'Invalid request', details?: unknown): HttpError {
  return new HttpError(400, message, details);
}

export function unauthorized(message = 'Unauthorized'): HttpError {
  return new HttpError(401, message);
}

/**
 * Central error handler. Client-facing responses never contain stack traces,
 * driver messages or environment details.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: 'Bad Request',
        message: 'Request validation failed',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    if (error instanceof HttpError) {
      reply.status(error.statusCode).send({
        error: statusText(error.statusCode),
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
      return;
    }

    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;

    if (statusCode >= 500) {
      request.log.error({ err: { message: error.message, code: error.code } }, 'Unhandled request error');
      reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
      return;
    }

    reply.status(statusCode).send({
      error: statusText(statusCode),
      message: statusCode === 400 ? 'Invalid request' : error.message,
    });
  });
}

function statusText(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 422:
      return 'Unprocessable Entity';
    case 503:
      return 'Service Unavailable';
    default:
      return 'Error';
  }
}

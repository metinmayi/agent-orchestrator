import { createHmac, timingSafeEqual } from 'crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

function verifySignature(payload: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  if (expected.length !== signatureHeader.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

function validateEvent(event: APIGatewayProxyEvent): APIGatewayProxyResult | null {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return { statusCode: 500, body: 'Webhook secret not configured' };
  }

  const signature = event.headers['x-hub-signature-256'] ?? event.headers['X-Hub-Signature-256'];
  if (!verifySignature(event.body ?? '', signature, secret)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  const githubEvent = event.headers['x-github-event'] ?? event.headers['X-GitHub-Event'];
  if (githubEvent !== 'issues') {
    return { statusCode: 400, body: 'Not a GitHub Issues event' };
  }

  const body = JSON.parse(event.body ?? '{}');
  if (body.action !== 'assigned') {
    return { statusCode: 200, body: 'Ignoring non-assigned action' };
  }

  return null;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const rejection = validateEvent(event);
  if (rejection) return rejection;

  return { statusCode: 200, body: 'OK, from Maestro!' };
}

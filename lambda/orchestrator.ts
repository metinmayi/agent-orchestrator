import { createHmac, timingSafeEqual } from 'crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as issuesHandler from './handlers/issues';
import * as pullRequestHandler from './handlers/pull-request';

function verifySignature(payload: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  if (expected.length !== signatureHeader.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return { statusCode: 500, body: 'Webhook secret not configured' };
  }

  const signature = event.headers['x-hub-signature-256'] ?? event.headers['X-Hub-Signature-256'];
  if (!verifySignature(event.body ?? '', signature, secret)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  if (!event.body) {
    return { statusCode: 400, body: 'Missing body' };
  }

  let body: any;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const githubEvent = event.headers['x-github-event'] ?? event.headers['X-GitHub-Event'];

  switch (githubEvent) {
    case 'issues':
      return issuesHandler.handle(body);
    case 'pull_request':
      return pullRequestHandler.handle(body);
    default:
      return { statusCode: 200, body: `Ignored event: ${githubEvent ?? 'unknown'}` };
  }
}

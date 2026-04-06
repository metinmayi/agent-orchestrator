import { createHmac, timingSafeEqual } from 'crypto';
import { ECSClient, ListTasksCommand, RunTaskCommand } from '@aws-sdk/client-ecs';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildEntrypointScript } from './entrypoint-script';

const ecs = new ECSClient({});
const MAX_CONCURRENT_TASKS = 2;

function verifySignature(payload: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  if (expected.length !== signatureHeader.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

type ValidationResult =
  | { ok: true; issueUrl: string; repoFullName: string }
  | { ok: false; response: APIGatewayProxyResult };

function validateEvent(event: APIGatewayProxyEvent): ValidationResult {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, response: { statusCode: 500, body: 'Webhook secret not configured' } };
  }

  const signature = event.headers['x-hub-signature-256'] ?? event.headers['X-Hub-Signature-256'];
  if (!verifySignature(event.body ?? '', signature, secret)) {
    return { ok: false, response: { statusCode: 401, body: 'Invalid signature' } };
  }

  const githubEvent = event.headers['x-github-event'] ?? event.headers['X-GitHub-Event'];
  if (githubEvent !== 'issues') {
    return { ok: false, response: { statusCode: 400, body: 'Not a GitHub Issues event' } };
  }

  const body = JSON.parse(event.body ?? '{}');
  if (body.action !== 'assigned') {
    return { ok: false, response: { statusCode: 200, body: 'Ignoring non-assigned action' } };
  }

  return {
    ok: true,
    issueUrl: body.issue.html_url,
    repoFullName: body.repository.full_name,
  };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const result = validateEvent(event);
  if (!result.ok) return result.response;

  const { issueUrl, repoFullName } = result;

  const runningTasks = await ecs.send(new ListTasksCommand({
    cluster: process.env.ECS_CLUSTER_ARN,
    desiredStatus: 'RUNNING',
  }));
  const activeCount = runningTasks.taskArns?.length ?? 0;
  if (activeCount >= MAX_CONCURRENT_TASKS) {
    return { statusCode: 429, body: JSON.stringify({ error: `Concurrency limit reached (${MAX_CONCURRENT_TASKS})` }) };
  }

  const script = buildEntrypointScript(issueUrl, repoFullName);

  const command = new RunTaskCommand({
    cluster: process.env.ECS_CLUSTER_ARN,
    taskDefinition: process.env.ECS_TASK_DEFINITION_ARN,
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: process.env.ECS_SUBNET_IDS!.split(','),
        securityGroups: process.env.ECS_SECURITY_GROUP_ID ? [process.env.ECS_SECURITY_GROUP_ID] : undefined,
        assignPublicIp: 'ENABLED',
      },
    },
    overrides: {
      containerOverrides: [{
        name: 'agent',
        command: ['bash', '-c', script],
      }],
    },
  });

  const taskResult = await ecs.send(command);
  const taskArn = taskResult.tasks?.[0]?.taskArn;

  return { statusCode: 200, body: JSON.stringify({ taskArn, issueUrl }) };
}

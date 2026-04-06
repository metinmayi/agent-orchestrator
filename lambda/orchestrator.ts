import { createHmac, timingSafeEqual } from 'crypto';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const ecs = new ECSClient({});

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

function buildEntrypointScript(issueUrl: string, repoFullName: string): string {
  const agentPrompt = `Using the PR-implementor agent, implement the following Github issue: ${issueUrl}`;

  return [
    'set -euo pipefail',

    '# ---------- 1. Install Claude Code ----------',
    'npm install -g @anthropic-ai/claude-code',

    '# ---------- 2. Authenticate with GitHub ----------',
    'NOW=$(date +%s)',
    'IAT=$((NOW - 60))',
    'EXP=$((NOW + 600))',
    `HEADER=$(echo -n '{"alg":"RS256","typ":"JWT"}' | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')`,
    `PAYLOAD=$(echo -n "{\\"iss\\":\\"$GITHUB_APP_ID\\",\\"iat\\":$IAT,\\"exp\\":$EXP}" | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')`,
    `SIGNATURE=$(echo -n "$HEADER.$PAYLOAD" | openssl dgst -sha256 -sign <(echo "$GITHUB_PRIVATE_KEY") | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')`,
    'JWT="$HEADER.$PAYLOAD.$SIGNATURE"',
    '',
    `INSTALLATION_ID=$(curl -s \\`,
    `  -H "Authorization: Bearer $JWT" \\`,
    `  -H "Accept: application/vnd.github+json" \\`,
    `  "https://api.github.com/repos/${repoFullName}/installation" | jq -r '.id')`,
    '',
    `export GITHUB_TOKEN=$(curl -s -X POST \\`,
    `  -H "Authorization: Bearer $JWT" \\`,
    `  -H "Accept: application/vnd.github+json" \\`,
    `  "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens" | jq -r '.token')`,
    '',
    '# ---------- 3. Pull repository ----------',
    `git clone "https://x-access-token:$GITHUB_TOKEN@github.com/${repoFullName}.git" /work/repo`,
    'cd /work/repo',
    `ls -la`, // Debugging line to verify repo contents

    '# ---------- 4. Set up GitHub MCP ----------',
    'claude mcp add-json github "{\\"type\\":\\"http\\",\\"url\\":\\"https://api.githubcopilot.com/mcp\\",\\"headers\\":{\\"Authorization\\":\\"Bearer $GITHUB_TOKEN\\"}}"',
    `claude mcp list`,

    '# ---------- 5. Execute agent ----------',
    `claude --permission-mode auto --print "${agentPrompt}" --verbose`,
  ].join('\n');
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const rejection = validateEvent(event);
  if (rejection) return rejection;

  const body = JSON.parse(event.body ?? '{}');
  const issueUrl: string = body.issue.html_url;
  const repoFullName: string = body.repository.full_name;

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

  const result = await ecs.send(command);
  const taskArn = result.tasks?.[0]?.taskArn;

  return { statusCode: 200, body: JSON.stringify({ taskArn, issueUrl }) };
}

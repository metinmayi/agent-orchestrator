import { ECSClient, ListTasksCommand, RunTaskCommand } from '@aws-sdk/client-ecs';
import type { APIGatewayProxyResult } from 'aws-lambda';
import { buildEntrypointScript } from './entrypoint-script';

const ecs = new ECSClient({});
const MAX_CONCURRENT_TASKS = 2;

export async function runAgentTask(
  agentPrompt: string,
  repoFullName: string,
  responseContext: Record<string, unknown> = {},
): Promise<APIGatewayProxyResult> {
  const runningTasks = await ecs.send(new ListTasksCommand({
    cluster: process.env.ECS_CLUSTER_ARN,
    desiredStatus: 'RUNNING',
  }));
  const activeCount = runningTasks.taskArns?.length ?? 0;
  if (activeCount >= MAX_CONCURRENT_TASKS) {
    return { statusCode: 429, body: JSON.stringify({ error: `Concurrency limit reached (${MAX_CONCURRENT_TASKS})` }) };
  }

  const script = buildEntrypointScript(agentPrompt, repoFullName);

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

  return { statusCode: 200, body: JSON.stringify({ taskArn, ...responseContext }) };
}

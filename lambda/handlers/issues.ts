import type { APIGatewayProxyResult } from 'aws-lambda';
import { runAgentTask } from '../run-agent';

export async function handle(body: any): Promise<APIGatewayProxyResult> {
  if (body.action !== 'assigned') {
    return { statusCode: 200, body: 'Ignoring non-assigned issues action' };
  }

  const issueUrl: string = body.issue.html_url;
  const repoFullName: string = body.repository.full_name;

  const agentCommand = `/pr-implement ${issueUrl}`;

  return runAgentTask(agentCommand, repoFullName, { issueUrl });
}

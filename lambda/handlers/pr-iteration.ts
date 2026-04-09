import type { APIGatewayProxyResult } from 'aws-lambda';
import { incrementAndCheck } from '../pr-iterations';
import { runAgentTask } from '../run-agent';

const MAX_ITERATIONS = 3;

export async function handle(body: any): Promise<APIGatewayProxyResult> {
  if (body.action !== 'created') {
    return { statusCode: 200, body: 'Ignoring non-created pull_request_review_comment action' };
  }

  const repoFullName: string = body.repository.full_name;
  const prNumber: number = body.pull_request.number;
  const prUrl: string = body.pull_request.html_url;
  const prKey = `${repoFullName}#${prNumber}`;

  const result = await incrementAndCheck(prKey, MAX_ITERATIONS);
  if (!result.allowed) {
    console.log('pull_request_review_comment.created iteration limit reached', { prKey, max: MAX_ITERATIONS });
    return { statusCode: 200, body: 'Iteration limit reached' };
  }

  const agentCommand = `/pr-iterate ${prUrl}`;

  return runAgentTask(agentCommand, repoFullName, { prUrl, iteration: result.count });
}

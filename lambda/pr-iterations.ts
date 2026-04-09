import { DynamoDBClient, UpdateItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

const dynamodb = new DynamoDBClient({});

const TABLE_NAME = 'agent-pr-iterations';

export type IncrementResult =
  | { allowed: true; count: number }
  | { allowed: false; count: number };

/**
 * Atomically increments the iteration counter for a PR, enforcing `maxIterations` as a cap.
 * Uses a single conditional UpdateItem so concurrent webhook events can't both slip past the limit.
 */
export async function incrementAndCheck(prKey: string, maxIterations: number): Promise<IncrementResult> {
  try {
    const result = await dynamodb.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: { prKey: { S: prKey } },
      UpdateExpression: 'ADD iterations :one',
      ConditionExpression: 'attribute_not_exists(iterations) OR iterations < :max',
      ExpressionAttributeValues: {
        ':one': { N: '1' },
        ':max': { N: maxIterations.toString() },
      },
      ReturnValues: 'UPDATED_NEW',
    }));

    const count = Number(result.Attributes?.iterations?.N ?? '0');
    return { allowed: true, count };
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return { allowed: false, count: maxIterations };
    }
    throw err;
  }
}

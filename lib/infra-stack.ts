import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { AgentCluster } from './constructs/agent-cluster';
import { WebhookApi } from './constructs/webhook-api';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const agentCluster = new AgentCluster(this, 'AgentCluster');
    const webhookApi = new WebhookApi(this, 'WebhookApi', { agentCluster });

    new cdk.CfnOutput(this, 'WebhookUrl', {
      value: webhookApi.url,
      description: 'URL to configure as the GitHub Webhook endpoint',
    });
  }
}

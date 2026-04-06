import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';
import { AgentCluster } from './agent-cluster';

interface WebhookApiProps {
  agentCluster: AgentCluster;
}

export class WebhookApi extends Construct {
  public readonly url: string;

  constructor(scope: Construct, id: string, props: WebhookApiProps) {
    super(scope, id);

    const { agentCluster } = props;

    // ---- Orchestrator Lambda ----
    const orchestratorFn = new nodejs.NodejsFunction(this, 'OrchestratorFunction', {
      entry: path.join(__dirname, '..', '..', 'lambda', 'orchestrator.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        ECS_CLUSTER_ARN: agentCluster.cluster.clusterArn,
        ECS_TASK_DEFINITION_ARN: agentCluster.taskDefinition.taskDefinitionArn,
        ECS_SUBNET_IDS: agentCluster.vpc.publicSubnets.map(s => s.subnetId).join(','),
        ECS_SECURITY_GROUP_ID: agentCluster.securityGroup.securityGroupId,
      },
    });

    orchestratorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:RunTask'],
      resources: [agentCluster.taskDefinition.taskDefinitionArn],
    }));
    orchestratorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [agentCluster.taskRole.roleArn, agentCluster.executionRole.roleArn],
    }));

    // ---- API Gateway ----
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'Agent Orchestrator Webhook',
      description: 'Receives GitHub webhook events for the agent orchestrator',
    });

    const webhook = api.root.addResource('webhook');
    webhook.addMethod('POST', new apigateway.LambdaIntegration(orchestratorFn));

    this.url = api.urlForPath('/webhook');
  }
}

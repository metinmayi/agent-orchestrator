import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import * as path from 'path';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const orchestratorFn = new nodejs.NodejsFunction(this, 'OrchestratorFunction', {
      entry: path.join(__dirname, '..', 'lambda', 'orchestrator.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    const api = new apigateway.RestApi(this, 'WebhookApi', {
      restApiName: 'Agent Orchestrator Webhook',
      description: 'Receives GitHub webhook events for the agent orchestrator',
    });

    const webhook = api.root.addResource('webhook');
    webhook.addMethod('POST', new apigateway.LambdaIntegration(orchestratorFn));

    new cdk.CfnOutput(this, 'WebhookUrl', {
      value: api.urlForPath('/webhook'),
      description: 'URL to configure as the GitHub Webhook endpoint',
    });
  }
}

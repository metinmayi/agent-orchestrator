import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---- Secrets ----
    const anthropicKeySecret = new secretsmanager.Secret(this, 'AnthropicApiKey', {
      secretName: 'agent/anthropic-api-key',
      description: 'Anthropic API key used by agent containers',
    });

    const githubAppIdSecret = new secretsmanager.Secret(this, 'GitHubAppId', {
      secretName: 'agent/github-app-id',
      description: 'GitHub App ID for generating installation tokens',
    });

    const githubPrivateKeySecret = new secretsmanager.Secret(this, 'GitHubPrivateKey', {
      secretName: 'agent/github-private-key',
      description: 'GitHub App private key (PEM) for signing JWTs',
    });

    // ---- Networking ----
    const vpc = new ec2.Vpc(this, 'AgentVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        name: 'Public',
        subnetType: ec2.SubnetType.PUBLIC,
      }],
    });

    const agentSecurityGroup = new ec2.SecurityGroup(this, 'AgentSecurityGroup', {
      vpc,
      description: 'Security group for agent Fargate tasks',
      allowAllOutbound: true,
    });

    // ---- ECS Cluster ----
    const cluster = new ecs.Cluster(this, 'AgentCluster', {
      clusterName: 'agent-orchestrator',
      vpc,
    });

    // ---- ECR Repository (import existing) ----
    const repo = ecr.Repository.fromRepositoryName(this, 'AgentRepo', 'github-agent');

    // ---- ECS Task Definition ----
    const taskRole = new iam.Role(this, 'AgentTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role assumed by agent Fargate tasks',
    });

    const executionRole = new iam.Role(this, 'AgentExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS execution role for pulling images and injecting secrets',
    });

    repo.grantPull(executionRole);
    anthropicKeySecret.grantRead(executionRole);
    githubAppIdSecret.grantRead(executionRole);
    githubPrivateKeySecret.grantRead(executionRole);

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'AgentTaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
      executionRole,
    });

    taskDefinition.addContainer('agent', {
      image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'agent',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      secrets: {
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropicKeySecret),
        GITHUB_APP_ID: ecs.Secret.fromSecretsManager(githubAppIdSecret),
        GITHUB_PRIVATE_KEY: ecs.Secret.fromSecretsManager(githubPrivateKeySecret),
      },
    });

    // ---- Orchestrator Lambda ----
    const orchestratorFn = new nodejs.NodejsFunction(this, 'OrchestratorFunction', {
      entry: path.join(__dirname, '..', 'lambda', 'orchestrator.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        ECS_CLUSTER_ARN: cluster.clusterArn,
        ECS_TASK_DEFINITION_ARN: taskDefinition.taskDefinitionArn,
        ECS_SUBNET_IDS: vpc.publicSubnets.map(s => s.subnetId).join(','),
        ECS_SECURITY_GROUP_ID: agentSecurityGroup.securityGroupId,
      },
    });

    orchestratorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:RunTask'],
      resources: [taskDefinition.taskDefinitionArn],
    }));
    orchestratorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [taskRole.roleArn, executionRole.roleArn],
    }));

    // ---- API Gateway ----
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

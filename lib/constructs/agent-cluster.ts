import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class AgentCluster extends Construct {
  public readonly cluster: ecs.ICluster;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly taskRole: iam.IRole;
  public readonly executionRole: iam.IRole;
  public readonly vpc: ec2.IVpc;
  public readonly securityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id);

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
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        name: 'Public',
        subnetType: ec2.SubnetType.PUBLIC,
      }],
    });

    this.securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for agent Fargate tasks',
      allowAllOutbound: true,
    });

    // ---- ECS Cluster ----
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: 'agent-orchestrator',
      vpc: this.vpc,
    });

    // ---- ECR Repository (import existing) ----
    const repo = ecr.Repository.fromRepositoryName(this, 'Repo', 'github-agent');

    // ---- IAM Roles ----
    this.taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role assumed by agent Fargate tasks',
    });

    this.executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS execution role for pulling images and injecting secrets',
    });

    repo.grantPull(this.executionRole);
    anthropicKeySecret.grantRead(this.executionRole);
    githubAppIdSecret.grantRead(this.executionRole);
    githubPrivateKeySecret.grantRead(this.executionRole);

    // ---- Task Definition ----
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole: this.taskRole,
      executionRole: this.executionRole,
    });

    this.taskDefinition.addContainer('agent', {
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
  }
}

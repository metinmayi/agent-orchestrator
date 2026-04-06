#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();
new InfraStack(app, 'AgentOrchestratorStack', {env: {
    region: 'eu-central-1',
    account: "982282471831",
}});

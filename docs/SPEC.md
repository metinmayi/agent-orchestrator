# Agent Orchestrator — POC Specification

## 1. Overview

A serverless system deployed on AWS Lambda that listens for GitHub Webhook events and provisions EC2 instances to run autonomous agents. Agents perform software engineering tasks and interact with GitHub directly via its API.

---

## 2. Architecture

```
GitHub
  │
  │  Webhook (HTTPS POST)
  ▼
API Gateway
  │
  ▼
Lambda: Orchestrator
  ├── Validates webhook signature
  ├── Extracts agent input from event payload
  └── Launches EC2 instance with input in user-data
        │
        ▼
      EC2 Instance (ephemeral)
        ├── Downloads and installs Claude Code
        ├── Authenticates with Claude
        ├── Sets up GitHub MCP with Claude
        ├── Authenticates with GitHub
        ├── Pulls down repository
        ├── Executes task
        └── Terminates self
              │
              ▼
           GitHub API
```

---

## 3. Components

### 3.1 API Gateway
- Single `POST /webhook` endpoint forwarding to the Orchestrator Lambda.

### 3.2 Orchestrator Lambda
**Trigger:** API Gateway  
**Responsibilities:**
- Verify `X-Hub-Signature-256` header against the webhook secret
- Parse the `X-GitHub-Event` header and JSON payload
- Extract the agent input from the event (see §4)
- Launch an EC2 instance with the agent input passed via `user-data`
- Return `200 OK` to GitHub

**Handled events:**

| GitHub Event | Action |
|---|---|
| `issues` | `assigned` |

### 3.3 EC2 Agent Instances
All agents run on identical `t3.medium` instances. The only difference between agent runs is the input passed via `user-data`. Each instance follows this lifecycle:

1. **Install** — download and install Claude Code
2. **Authenticate with Claude** — configure Claude Code with the Anthropic API key
3. **Set up GitHub MCP** — configure the GitHub MCP server within Claude Code
4. **Authenticate with GitHub** — fetch GitHub App credentials from AWS Secrets Manager and generate an installation token
5. **Pull repository** — clone the target repository
6. **Execute** — run the agent task using Claude Code with the provided input
7. **Terminate** — call `ec2:TerminateInstances` on self

---

## 4. Agent Input

When an `issues` / `assigned` event is received, the Orchestrator constructs the following prompt and passes it to the EC2 instance via `user-data`:

```
Using the PR-creator agent, implement the following Github issue: <issue_url>
```

Where `<issue_url>` is derived from `issue.html_url` in the webhook payload. The agent instructions themselves live in the repository.


---

## 5. Secrets

Stored in AWS Secrets Manager, fetched by the EC2 instance at runtime:

| Secret | Used By |
|---|---|
| GitHub Webhook secret | Orchestrator Lambda |
| GitHub App private key | EC2 agents |
| GitHub App ID | EC2 agents |
| Anthropic API key | EC2 agents |

---
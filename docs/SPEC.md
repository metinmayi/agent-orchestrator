# Agent Orchestrator — POC Specification

## 1. Overview

A serverless system deployed on AWS that listens for GitHub Webhook events and launches ECS Fargate tasks to run autonomous agents. Agents perform software engineering tasks and interact with GitHub directly via its API.

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
  └── Launches ECS Fargate task with input as container command override
        │
        ▼
      Fargate Task (ephemeral)
        ├── Installs Claude Code
        ├── Authenticates with GitHub via App credentials
        ├── Clones target repository
        ├── Configures GitHub MCP server in Claude Code
        ├── Executes agent task
        └── Exits (task stops automatically)
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
- Launch an ECS Fargate task with the agent input passed as a container command override
- Return `200 OK` to GitHub

**Handled events:**

| GitHub Event | Action |
|---|---|
| `issues` | `assigned` |

### 3.3 Fargate Agent Tasks
All agents run as Fargate tasks (1 vCPU, 2 GB memory) using an image from ECR. The only difference between agent runs is the entrypoint script passed via container command override. Each task follows this lifecycle:

1. **Install** — install Claude Code via npm
2. **Authenticate with GitHub** — generate a JWT from the GitHub App credentials (injected via Secrets Manager), exchange it for an installation token
3. **Clone repository** — clone the target repository using the installation token
4. **Configure MCP** — set up the GitHub MCP server within Claude Code
5. **Execute** — run the agent task using Claude Code with the provided prompt
6. **Exit** — task stops automatically when the process completes

---

## 4. Agent Input

When an `issues` / `assigned` event is received, the Orchestrator constructs the following prompt and passes it to the Fargate task:

```
Using the PR-implementor agent, implement the following Github issue: <issue_url>
```

Where `<issue_url>` is derived from `issue.html_url` in the webhook payload. The agent instructions themselves live in the repository.


---

## 5. Secrets

Stored in AWS Secrets Manager, injected into Fargate tasks at launch:

| Secret | Used By |
|---|---|
| GitHub Webhook secret | Orchestrator Lambda |
| GitHub App private key | Fargate agents |
| GitHub App ID | Fargate agents |
| Anthropic API key | Fargate agents |

---

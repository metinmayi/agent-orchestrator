export function buildEntrypointScript(agentCommand: string, repoFullName: string, claudeFlags: string[]): string {
  return [
    'set -euo pipefail',

    '# ---------- 1. Authenticate with GitHub ----------',
    'NOW=$(date +%s)',
    'IAT=$((NOW - 60))',
    'EXP=$((NOW + 600))',
    `HEADER=$(echo -n '{"alg":"RS256","typ":"JWT"}' | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')`,
    `PAYLOAD=$(echo -n "{\\"iss\\":\\"$GITHUB_APP_ID\\",\\"iat\\":$IAT,\\"exp\\":$EXP}" | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')`,
    `SIGNATURE=$(echo -n "$HEADER.$PAYLOAD" | openssl dgst -sha256 -sign <(echo "$GITHUB_PRIVATE_KEY") | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')`,
    'JWT="$HEADER.$PAYLOAD.$SIGNATURE"',
    '',
    `INSTALLATION_ID=$(curl -s \\`,
    `  -H "Authorization: Bearer $JWT" \\`,
    `  -H "Accept: application/vnd.github+json" \\`,
    `  "https://api.github.com/repos/${repoFullName}/installation" | jq -r '.id')`,
    '',
    `export GITHUB_TOKEN=$(curl -s -X POST \\`,
    `  -H "Authorization: Bearer $JWT" \\`,
    `  -H "Accept: application/vnd.github+json" \\`,
    `  "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens" | jq -r '.token')`,
    '',
    '# ---------- 2. Pull repository ----------',
    `git clone "https://x-access-token:$GITHUB_TOKEN@github.com/${repoFullName}.git" /work/repo`,
    'cd /work/repo',

    '# ---------- 3. Set up GitHub MCP ----------',
    'claude mcp add-json github "{\\"type\\":\\"http\\",\\"url\\":\\"https://api.githubcopilot.com/mcp\\",\\"headers\\":{\\"Authorization\\":\\"Bearer $GITHUB_TOKEN\\"}}"',
    `claude mcp list`,

    '# ---------- 4. Execute agent ----------',
    `claude -p "${agentCommand}" ${claudeFlags.join(' ')}`,
  ].join('\n');
}

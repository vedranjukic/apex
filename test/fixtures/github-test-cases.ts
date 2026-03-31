/**
 * Test fixtures for GitHub CLI authentication scenarios
 */

export interface TestCase {
  name: string;
  command: string;
  expectedExitCode: number;
  expectedOutput?: RegExp | string;
  requiresRepo?: boolean;
  timeout?: number;
}

export const githubCliTestCases: TestCase[] = [
  // Basic API tests
  {
    name: 'Get authenticated user',
    command: 'gh api user',
    expectedExitCode: 0,
    expectedOutput: /"login":/,
  },
  {
    name: 'Get user with specific fields',
    command: 'gh api user --jq .login',
    expectedExitCode: 0,
  },
  {
    name: 'Check rate limit',
    command: 'gh api rate_limit',
    expectedExitCode: 0,
    expectedOutput: /"limit":/,
  },
  
  // Repository operations
  {
    name: 'List user repositories',
    command: 'gh repo list --limit 3 --json name,description',
    expectedExitCode: 0,
    expectedOutput: /\[/,
  },
  {
    name: 'View specific repo',
    command: 'gh repo view cli/cli --json name,description',
    expectedExitCode: 0,
    expectedOutput: /"name":\s*"cli"/,
  },
  
  // Issue operations
  {
    name: 'List issues in cli/cli repo',
    command: 'gh issue list --repo cli/cli --limit 3 --json number,title',
    expectedExitCode: 0,
    expectedOutput: /\[/,
  },
  {
    name: 'View specific issue',
    command: 'gh issue view 1 --repo cli/cli --json number,title',
    expectedExitCode: 0,
    expectedOutput: /"number":\s*1/,
  },
  
  // Pull request operations
  {
    name: 'List PRs in cli/cli repo',
    command: 'gh pr list --repo cli/cli --limit 3 --json number,title',
    expectedExitCode: 0,
    expectedOutput: /\[/,
  },
  
  // Auth operations
  {
    name: 'Check auth status',
    command: 'gh auth status',
    expectedExitCode: 0,
    expectedOutput: /Logged in/,
  },
  
  // Gist operations
  {
    name: 'List gists',
    command: 'gh gist list --limit 3',
    expectedExitCode: 0,
  },
  
  // API with different domains
  {
    name: 'Access raw content',
    command: 'gh api https://raw.githubusercontent.com/cli/cli/trunk/README.md --include',
    expectedExitCode: 0,
    expectedOutput: /HTTP.*200/,
    timeout: 10000,
  },
  
  // Error scenarios
  {
    name: 'Invalid API endpoint',
    command: 'gh api /invalid-endpoint-that-does-not-exist',
    expectedExitCode: 1,
    expectedOutput: /404|Not Found/,
  },
  {
    name: 'API without token (should fail)',
    command: 'GH_TOKEN="" gh api user',
    expectedExitCode: 1,
    expectedOutput: /401|Unauthorized|Bad credentials/,
  },
];

export const repoSpecificTestCases: TestCase[] = [
  {
    name: 'Current repo info',
    command: 'gh repo view --json name,owner',
    expectedExitCode: 0,
    expectedOutput: /"name":/,
    requiresRepo: true,
  },
  {
    name: 'List issues in current repo',
    command: 'gh issue list --limit 5',
    expectedExitCode: 0,
    requiresRepo: true,
  },
  {
    name: 'List PRs in current repo',
    command: 'gh pr list --limit 5',
    expectedExitCode: 0,
    requiresRepo: true,
  },
  {
    name: 'Show git remote',
    command: 'gh repo view --json url',
    expectedExitCode: 0,
    expectedOutput: /"url":/,
    requiresRepo: true,
  },
];

export const debugCommands = [
  'env | grep -E "(HTTPS_PROXY|GH_TOKEN|SSL_CERT_FILE)"',
  'ls -la /usr/local/share/ca-certificates/',
  'curl -I --proxy $HTTPS_PROXY https://api.github.com',
  'GH_DEBUG=api gh api user 2>&1 | head -20',
];

export function generateTestScript(testCases: TestCase[]): string {
  const script = `#!/bin/bash
# GitHub CLI Authentication Test Script
# Generated test cases for validating gh CLI authentication

set -e

echo "=== GitHub CLI Authentication Tests ==="
echo "Running ${testCases.length} test cases..."
echo ""

FAILED_TESTS=0
PASSED_TESTS=0

`;

  for (const testCase of testCases) {
    const timeout = testCase.timeout ? `timeout ${testCase.timeout / 1000}` : '';
    script += `
# Test: ${testCase.name}
echo -n "Testing: ${testCase.name}... "
if ${timeout} ${testCase.command} > /tmp/gh-test-output 2>&1; then
  if [ ${testCase.expectedExitCode} -eq 0 ]; then
    ${testCase.expectedOutput ? `if grep -qE '${testCase.expectedOutput.source || testCase.expectedOutput}' /tmp/gh-test-output; then
      echo "✓ PASSED"
      PASSED_TESTS=$((PASSED_TESTS + 1))
    else
      echo "✗ FAILED (output mismatch)"
      cat /tmp/gh-test-output
      FAILED_TESTS=$((FAILED_TESTS + 1))
    fi` : `echo "✓ PASSED"
    PASSED_TESTS=$((PASSED_TESTS + 1))`}
  else
    echo "✗ FAILED (expected failure but succeeded)"
    FAILED_TESTS=$((FAILED_TESTS + 1))
  fi
else
  EXIT_CODE=$?
  if [ ${testCase.expectedExitCode} -ne 0 ]; then
    echo "✓ PASSED (expected failure)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    echo "✗ FAILED (exit code: $EXIT_CODE)"
    cat /tmp/gh-test-output
    FAILED_TESTS=$((FAILED_TESTS + 1))
  fi
fi
`;
  }

  script += `
echo ""
echo "=== Test Summary ==="
echo "Passed: $PASSED_TESTS"
echo "Failed: $FAILED_TESTS"
echo "Total: ${testCases.length}"

if [ $FAILED_TESTS -gt 0 ]; then
  exit 1
fi
`;

  return script;
}

export const testEnvironmentSetup = `#!/bin/bash
# Setup test environment for GitHub CLI authentication

echo "Setting up test environment..."

# 1. Install GitHub CLI if not present
if ! command -v gh &> /dev/null; then
  echo "Installing GitHub CLI..."
  if command -v apt-get &> /dev/null; then
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    sudo apt update
    sudo apt install gh -y
  else
    echo "Cannot install gh CLI - apt-get not available"
    exit 1
  fi
fi

# 2. Verify environment variables
echo "Checking environment..."
MISSING_VARS=0

if [ -z "$HTTPS_PROXY" ]; then
  echo "✗ HTTPS_PROXY not set"
  MISSING_VARS=1
else
  echo "✓ HTTPS_PROXY=$HTTPS_PROXY"
fi

if [ -z "$GH_TOKEN" ]; then
  echo "✗ GH_TOKEN not set"
  MISSING_VARS=1
else
  echo "✓ GH_TOKEN is set"
fi

if [ -z "$SSL_CERT_FILE" ]; then
  echo "✗ SSL_CERT_FILE not set"
  MISSING_VARS=1
else
  echo "✓ SSL_CERT_FILE=$SSL_CERT_FILE"
fi

# 3. Check CA certificate
if [ -f /usr/local/share/ca-certificates/apex-proxy.crt ]; then
  echo "✓ Apex CA certificate found"
else
  echo "✗ Apex CA certificate missing"
  MISSING_VARS=1
fi

# 4. Test proxy connectivity
echo ""
echo "Testing proxy connectivity..."
PROXY_HOST=$(echo $HTTPS_PROXY | sed 's|.*://||' | sed 's|:.*||')
PROXY_PORT=$(echo $HTTPS_PROXY | sed 's|.*:||')

if timeout 5 nc -zv "$PROXY_HOST" "$PROXY_PORT" 2>/dev/null; then
  echo "✓ Proxy is reachable"
else
  echo "✗ Proxy is not reachable"
  MISSING_VARS=1
fi

if [ $MISSING_VARS -eq 1 ]; then
  echo ""
  echo "⚠ Environment not properly configured for GitHub CLI authentication"
  exit 1
fi

echo ""
echo "✓ Environment is properly configured"
`;
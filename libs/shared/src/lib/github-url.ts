export type GitHubUrlType = 'repo' | 'issue' | 'pull' | 'branch' | 'commit';

export interface ParsedGitHubUrl {
  type: GitHubUrlType;
  owner: string;
  repo: string;
  cloneUrl: string;
  number?: number;
  ref?: string;
}

const GITHUB_HOST = /^(?:https?:\/\/)?(?:www\.)?github\.com\//;

/**
 * Parse a GitHub URL into its constituent parts.
 * Supports: repo, issue, PR, branch (tree), and commit URLs.
 * Returns null for non-GitHub or unparseable URLs.
 */
export function parseGitHubUrl(raw: string): ParsedGitHubUrl | null {
  const trimmed = raw.trim();
  if (!GITHUB_HOST.test(trimmed)) return null;

  const path = trimmed.replace(GITHUB_HOST, '').replace(/\.git$/, '').replace(/\/$/, '');
  const segments = path.split('/');

  if (segments.length < 2) return null;
  const [owner, repo] = segments;
  if (!owner || !repo) return null;

  const cloneUrl = `https://github.com/${owner}/${repo}.git`;

  if (segments.length === 2) {
    return { type: 'repo', owner, repo, cloneUrl };
  }

  const kind = segments[2];

  if (kind === 'issues' && segments[3]) {
    const num = parseInt(segments[3], 10);
    if (isNaN(num)) return null;
    return { type: 'issue', owner, repo, cloneUrl, number: num };
  }

  if (kind === 'pull' && segments[3]) {
    const num = parseInt(segments[3], 10);
    if (isNaN(num)) return null;
    return { type: 'pull', owner, repo, cloneUrl, number: num };
  }

  if (kind === 'tree' && segments.length > 3) {
    const ref = segments.slice(3).join('/');
    return { type: 'branch', owner, repo, cloneUrl, ref };
  }

  if (kind === 'commit' && segments[3]) {
    return { type: 'commit', owner, repo, cloneUrl, ref: segments[3] };
  }

  return { type: 'repo', owner, repo, cloneUrl };
}

/**
 * Generate a git-safe branch name from a GitHub issue number and title.
 * Example: issue 42 "Fix login page crash!" → "issue-42/fix-login-page-crash"
 */
export function issueBranchName(issueNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');
  return `issue-${issueNumber}/${slug || 'work'}`;
}

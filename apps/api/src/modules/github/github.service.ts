import { parseGitHubUrl, type ParsedGitHubUrl, type IMergeStatusData } from '@apex/shared';

export interface GitHubIssueContent {
  type: 'issue';
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  state: string;
}

export interface GitHubPullContent {
  type: 'pull';
  number: number;
  title: string;
  body: string;
  url: string;
  branch: string;
  baseBranch: string;
  labels: string[];
  state: string;
}

export type GitHubContent = GitHubIssueContent | GitHubPullContent;

export interface ResolveResult {
  parsed: ParsedGitHubUrl;
  content?: GitHubContent;
}

export interface GitHubUser {
  name: string;
  email: string;
  login: string;
  avatarUrl: string;
}

export interface GitHubPullRequestData {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state: string;
  head: {
    sha: string;
    ref: string;
  };
  base: {
    sha: string;
    ref: string;
  };
  commits_behind_by?: number;
}

export interface GitHubCommitStatus {
  state: 'pending' | 'success' | 'error' | 'failure';
  statuses: Array<{
    state: 'pending' | 'success' | 'error' | 'failure';
    context: string;
    description: string;
    target_url?: string;
  }>;
  check_runs?: Array<{
    name: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  }>;
}

export interface GitHubCheckSuites {
  total_count: number;
  check_suites: Array<{
    id: number;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
    app: {
      name: string;
    };
  }>;
}

class GitHubService {
  private userCache: (GitHubUser & { token: string }) | null = null;

  private get token(): string | undefined {
    return process.env['GITHUB_TOKEN'];
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async ghFetch(path: string, retries = 3): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(`https://api.github.com${path}`, { headers });
        
        if (res.ok) {
          return res.json();
        }

        // Handle rate limiting with exponential backoff
        if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
          const resetTime = res.headers.get('x-ratelimit-reset');
          const retryAfter = res.headers.get('retry-after');
          
          if (attempt < retries - 1) {
            let delayMs: number;
            if (retryAfter) {
              delayMs = parseInt(retryAfter, 10) * 1000;
            } else if (resetTime) {
              const resetTimestamp = parseInt(resetTime, 10) * 1000;
              delayMs = Math.max(resetTimestamp - Date.now(), 1000);
            } else {
              // Exponential backoff: 1s, 2s, 4s, etc.
              delayMs = Math.min(1000 * Math.pow(2, attempt), 30000);
            }
            
            console.log(`[github] Rate limited, waiting ${delayMs}ms before retry ${attempt + 1}/${retries}`);
            await this.delay(delayMs);
            continue;
          }
        }

        // Handle other server errors with exponential backoff
        if (res.status >= 500 && attempt < retries - 1) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`[github] Server error ${res.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${retries})`);
          await this.delay(delayMs);
          continue;
        }

        const body = await res.text();
        lastError = new Error(`GitHub API ${res.status}: ${body}`);

        // 4xx client errors (except rate limiting handled above) are definitive — don't retry
        if (res.status >= 400 && res.status < 500) {
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < retries - 1) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`[github] Request failed, retrying in ${delayMs}ms (attempt ${attempt + 1}/${retries}): ${lastError.message}`);
          await this.delay(delayMs);
          continue;
        }
      }
    }

    throw lastError || new Error('Unknown GitHub API error');
  }

  async fetchIssue(owner: string, repo: string, number: number): Promise<GitHubIssueContent> {
    const data = await this.ghFetch(`/repos/${owner}/${repo}/issues/${number}`);
    return {
      type: 'issue',
      number,
      title: data.title,
      body: data.body ?? '',
      url: data.html_url,
      labels: (data.labels ?? []).map((l: any) => (typeof l === 'string' ? l : l.name)),
      state: data.state,
    };
  }

  async fetchPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullContent> {
    const data = await this.ghFetch(`/repos/${owner}/${repo}/pulls/${number}`);
    return {
      type: 'pull',
      number,
      title: data.title,
      body: data.body ?? '',
      url: data.html_url,
      branch: data.head?.ref ?? '',
      baseBranch: data.base?.ref ?? 'main',
      labels: (data.labels ?? []).map((l: any) => (typeof l === 'string' ? l : l.name)),
      state: data.state,
    };
  }

  async fetchUser(): Promise<GitHubUser | null> {
    if (!this.token) return null;
    if (this.userCache && this.userCache.token === this.token) {
      const { token: _t, ...user } = this.userCache;
      return user;
    }

    try {
      const data = await this.ghFetch('/user');
      let email: string = data.email ?? '';

      if (!email) {
        try {
          const emails: any[] = await this.ghFetch('/user/emails');
          const primary = emails.find((e) => e.primary && e.verified);
          email = primary?.email ?? `${data.id}+${data.login}@users.noreply.github.com`;
        } catch {
          email = `${data.id}+${data.login}@users.noreply.github.com`;
        }
      }

      const user: GitHubUser = {
        name: data.name || data.login,
        email,
        login: data.login,
        avatarUrl: data.avatar_url ?? '',
      };
      this.userCache = { ...user, token: this.token! };
      return user;
    } catch (err) {
      console.log(`[github] Failed to fetch user: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  async fetchPullRequestMergeStatus(owner: string, repo: string, number: number): Promise<GitHubPullRequestData> {
    const data = await this.ghFetch(`/repos/${owner}/${repo}/pulls/${number}`);
    return {
      number,
      state: data.state,
      merged: data.merged || false,
      mergeable: data.mergeable,
      mergeable_state: data.mergeable_state || 'unknown',
      head: {
        sha: data.head?.sha || '',
        ref: data.head?.ref || '',
      },
      base: {
        sha: data.base?.sha || '',
        ref: data.base?.ref || '',
      },
      commits_behind_by: data.behind_by || 0,
    };
  }

  async fetchCommitChecksStatus(owner: string, repo: string, sha: string): Promise<GitHubCommitStatus> {
    try {
      // Fetch commit status (legacy status API)
      const statusData = await this.ghFetch(`/repos/${owner}/${repo}/commits/${sha}/status`);
      
      // Fetch check runs (newer checks API)
      let checkRuns: any[] = [];
      try {
        const checksData = await this.ghFetch(`/repos/${owner}/${repo}/commits/${sha}/check-runs`);
        checkRuns = checksData.check_runs || [];
      } catch (err) {
        console.log(`[github] Failed to fetch check runs for ${sha}: ${err instanceof Error ? err.message : err}`);
      }

      return {
        state: statusData.state || 'pending',
        statuses: (statusData.statuses || []).map((status: any) => ({
          state: status.state,
          context: status.context,
          description: status.description,
          target_url: status.target_url,
        })),
        check_runs: checkRuns.map((run: any) => ({
          name: run.name,
          status: run.status,
          conclusion: run.conclusion,
        })),
      };
    } catch (error) {
      console.log(`[github] Failed to fetch commit checks for ${sha}: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  async findPrByBranch(owner: string, repo: string, branch: string): Promise<{ number: number; state: string } | null> {
    try {
      const data = await this.ghFetch(`/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=all&per_page=1`);
      if (Array.isArray(data) && data.length > 0) {
        return { number: data[0].number, state: data[0].state };
      }
      return null;
    } catch (error) {
      console.log(`[github] Failed to find PR for branch ${branch}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  async getProjectMergeStatus(project: { repoUrl?: string; issueUrl?: string; branchName?: string }): Promise<IMergeStatusData | null> {
    try {
      const url = project.issueUrl || project.repoUrl;
      if (!url) return null;

      const parsed = parseGitHubUrl(url);
      if (!parsed) return null;

      let prNumber: number | undefined = undefined;

      if (parsed.type === 'pull' && parsed.number) {
        prNumber = parsed.number;
      } else if (project.branchName && parsed.owner && parsed.repo) {
        // For issue-based or repo-based projects, look up PR by branch name
        const pr = await this.findPrByBranch(parsed.owner, parsed.repo, project.branchName);
        if (pr) {
          prNumber = pr.number;
        }
      }

      if (!prNumber) return null;

      const prData = await this.fetchPullRequestMergeStatus(parsed.owner, parsed.repo, prNumber);
      
      const checksData = await this.fetchCommitChecksStatus(parsed.owner, parsed.repo, prData.head.sha);

      let checksStatus: 'pending' | 'success' | 'failure' | 'neutral' = 'pending';
      
      if (checksData.state === 'success' && checksData.check_runs?.every(run => 
        run.status === 'completed' && ['success', 'neutral', 'skipped'].includes(run.conclusion || '')
      )) {
        checksStatus = 'success';
      } else if (checksData.state === 'failure' || checksData.check_runs?.some(run => 
        run.status === 'completed' && ['failure', 'cancelled', 'timed_out'].includes(run.conclusion || '')
      )) {
        checksStatus = 'failure';
      } else if (checksData.check_runs?.every(run => 
        run.status === 'completed' && run.conclusion === 'neutral'
      )) {
        checksStatus = 'neutral';
      }

      const prState: 'open' | 'closed' | 'merged' = prData.merged ? 'merged' : prData.state as 'open' | 'closed';

      return {
        mergeable: prData.mergeable,
        mergeable_state: prData.mergeable_state,
        checks_status: checksStatus,
        merge_behind_by: prData.commits_behind_by || 0,
        last_checked: new Date().toISOString(),
        pr_state: prState,
      };
    } catch (error) {
      console.log(`[github] Failed to get project merge status: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  async batchCheckMergeStatus(projects: Array<{ id: string; repoUrl?: string; issueUrl?: string; branchName?: string }>): Promise<Array<{ projectId: string; mergeStatus: IMergeStatusData | null }>> {
    const results = await Promise.allSettled(
      projects.map(async (project) => {
        const mergeStatus = await this.getProjectMergeStatus(project);
        return { projectId: project.id, mergeStatus };
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.log(`[github] Failed to check merge status for project ${projects[index].id}: ${result.reason}`);
        return { projectId: projects[index].id, mergeStatus: null };
      }
    });
  }

  async resolve(url: string): Promise<ResolveResult> {
    const parsed = parseGitHubUrl(url);
    if (!parsed) throw new Error('Not a valid GitHub URL');

    let content: GitHubContent | undefined;

    if (parsed.type === 'issue' && parsed.number) {
      content = await this.fetchIssue(parsed.owner, parsed.repo, parsed.number);
    } else if (parsed.type === 'pull' && parsed.number) {
      content = await this.fetchPullRequest(parsed.owner, parsed.repo, parsed.number);
      if (!parsed.ref && content.type === 'pull') {
        parsed.ref = content.branch;
      }
    }

    return { parsed, content };
  }
}

export const githubService = new GitHubService();

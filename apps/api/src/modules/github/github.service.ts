import { parseGitHubUrl, type ParsedGitHubUrl } from '@apex/shared';

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

class GitHubService {
  private userCache: (GitHubUser & { token: string }) | null = null;

  private get token(): string | undefined {
    return process.env['GITHUB_TOKEN'];
  }

  private async ghFetch(path: string): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`https://api.github.com${path}`, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res.json();
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

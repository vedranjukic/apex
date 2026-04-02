import { projectsService } from '../projects/projects.service';
import { githubService } from './github.service';
import { projectsWsBroadcast } from '../projects/projects.ws';
import { db } from '../../database/db';
import { projects } from '../../database/schema';
import { isNull } from 'drizzle-orm';
import type { IMergeStatusData } from '@apex/shared';

export interface PollingConfig {
  intervalMinutes: number;
  enabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
}

interface ProjectWithGitHubUrls {
  id: string;
  repoUrl?: string | null;
  issueUrl?: string | null;
}

class GitHubMergePollerService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private config: PollingConfig = {
    intervalMinutes: parseInt(process.env.GITHUB_MERGE_POLL_INTERVAL_MINUTES || '10', 10),
    enabled: process.env.GITHUB_MERGE_POLLING_ENABLED !== 'false',
    maxRetries: 3,
    retryDelayMs: 5000,
  };

  constructor() {
    // Validate configuration
    if (this.config.intervalMinutes < 1) {
      console.warn('[github-merge-poller] Invalid interval, using default 10 minutes');
      this.config.intervalMinutes = 10;
    }
  }

  /**
   * Initialize the service. Should be called during application startup.
   */
  async init(): Promise<void> {
    console.log('[github-merge-poller] Initializing GitHub merge polling service');
    
    // Log configuration
    console.log(`[github-merge-poller] Configuration: enabled=${this.config.enabled}, interval=${this.config.intervalMinutes}min, hasGitHubToken=${!!process.env.GITHUB_TOKEN}`);
    
    // Start the service if enabled
    await this.start();
  }

  /**
   * Cleanup method for graceful shutdown.
   */
  async shutdown(): Promise<void> {
    console.log('[github-merge-poller] Shutting down');
    this.stop();
  }

  /**
   * Start the background polling service.
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[github-merge-poller] Polling disabled via configuration');
      return;
    }

    if (!process.env.GITHUB_TOKEN) {
      console.warn('[github-merge-poller] GitHub token not configured, polling disabled');
      return;
    }

    if (this.isRunning) {
      console.warn('[github-merge-poller] Service already running');
      return;
    }

    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    console.log(`[github-merge-poller] Starting service with ${this.config.intervalMinutes} minute interval`);

    this.isRunning = true;

    // Run initial poll after a short delay to avoid blocking startup
    setTimeout(() => {
      this.pollAllProjects().catch(err => {
        console.error('[github-merge-poller] Initial poll failed:', err);
      });
    }, 5000);

    // Schedule recurring polls
    this.intervalId = setInterval(() => {
      this.pollAllProjects().catch(err => {
        console.error('[github-merge-poller] Scheduled poll failed:', err);
      });
    }, intervalMs);
  }

  /**
   * Stop the background polling service.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('[github-merge-poller] Stopping service');
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isRunning = false;
  }

  /**
   * Manually trigger a poll for all projects (for testing or on-demand refresh).
   */
  async triggerPoll(): Promise<void> {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GitHub token not configured');
    }

    await this.pollAllProjects();
  }

  /**
   * Get current service status.
   */
  getStatus() {
    return {
      enabled: this.config.enabled,
      running: this.isRunning,
      intervalMinutes: this.config.intervalMinutes,
      hasGitHubToken: !!process.env.GITHUB_TOKEN,
    };
  }

  /**
   * Update polling configuration.
   */
  updateConfig(newConfig: Partial<PollingConfig>): void {
    const oldInterval = this.config.intervalMinutes;
    this.config = { ...this.config, ...newConfig };

    // If interval changed and service is running, restart with new interval
    if (this.isRunning && newConfig.intervalMinutes && newConfig.intervalMinutes !== oldInterval) {
      this.stop();
      this.start();
    }
  }

  /**
   * Main polling logic - fetches all projects with GitHub URLs and updates their merge status.
   */
  private async pollAllProjects(): Promise<void> {
    try {
      console.log('[github-merge-poller] Starting merge status poll cycle');
      
      const projects = await this.getProjectsWithGitHubUrls();
      
      if (projects.length === 0) {
        console.log('[github-merge-poller] No projects with GitHub URLs found');
        return;
      }

      console.log(`[github-merge-poller] Found ${projects.length} projects with GitHub URLs to check`);

      // Use batch processing to respect rate limits
      const results = await this.batchUpdateMergeStatuses(projects);

      // Count success/failure statistics
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      console.log(`[github-merge-poller] Poll cycle completed: ${successful} successful, ${failed} failed`);

      // Broadcast overall update notification
      if (successful > 0) {
        projectsWsBroadcast('merge-status-poll-completed', {
          totalProjects: projects.length,
          successfulUpdates: successful,
          failedUpdates: failed,
          timestamp: new Date().toISOString(),
        });
      }

    } catch (error) {
      console.error('[github-merge-poller] Failed to poll merge statuses:', error);
      
      // Broadcast error notification
      projectsWsBroadcast('merge-status-poll-error', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get all projects that have GitHub URLs (gitRepo or githubContext.url).
   */
  private async getProjectsWithGitHubUrls(): Promise<ProjectWithGitHubUrls[]> {
    try {
      // Get all non-deleted projects from the database directly
      const allProjects = await db.query.projects.findMany({
        where: isNull(projects.deletedAt),
        columns: {
          id: true,
          gitRepo: true,
          githubContext: true,
        },
      });
      
      // Filter for projects that have GitHub URLs
      return allProjects
        .filter(project => {
          const hasRepoUrl = project.gitRepo && project.gitRepo.includes('github.com');
          const hasIssueUrl = project.githubContext?.url && project.githubContext.url.includes('github.com');
          return hasRepoUrl || hasIssueUrl;
        })
        .map(project => ({
          id: project.id,
          repoUrl: project.gitRepo,
          issueUrl: project.githubContext?.url || null,
        }));
    } catch (error) {
      console.error('[github-merge-poller] Failed to fetch projects:', error);
      return [];
    }
  }

  /**
   * Update merge status for multiple projects using GitHub service batch operation.
   */
  private async batchUpdateMergeStatuses(projects: ProjectWithGitHubUrls[]): Promise<Array<{ projectId: string; success: boolean; error?: string }>> {
    let attempt = 0;
    
    while (attempt < this.config.maxRetries) {
      try {
        // Use the existing batch method from projects service
        return await projectsService.batchRefreshMergeStatus(projects.map(p => p.id));
      } catch (error) {
        attempt++;
        const isLastAttempt = attempt >= this.config.maxRetries;
        
        if (isLastAttempt) {
          console.error(`[github-merge-poller] Batch update failed after ${attempt} attempts:`, error);
          
          // Return failure results for all projects
          return projects.map(p => ({
            projectId: p.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        } else {
          console.warn(`[github-merge-poller] Batch update failed (attempt ${attempt}/${this.config.maxRetries}), retrying in ${this.config.retryDelayMs}ms:`, error);
          await this.delay(this.config.retryDelayMs);
        }
      }
    }

    // This should never be reached, but TypeScript requires it
    return [];
  }

  /**
   * Utility method for delays.
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Handle individual project merge status update and broadcast.
   * This method can be called externally for real-time updates.
   */
  async updateProjectMergeStatus(projectId: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[github-merge-poller] Updating merge status for project ${projectId}`);
      
      const updatedProject = await projectsService.refreshMergeStatusFromGitHub(projectId);
      
      // Broadcast individual project update
      projectsWsBroadcast('merge-status-updated', {
        projectId: updatedProject.id,
        mergeStatus: updatedProject.mergeStatus,
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[github-merge-poller] Failed to update merge status for project ${projectId}:`, errorMsg);
      
      return { success: false, error: errorMsg };
    }
  }
}

export const gitHubMergePollerService = new GitHubMergePollerService();
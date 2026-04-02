# GitHub Merge Status Polling Service

This service provides background polling of GitHub PR merge status for projects in the system.

## Overview

The `GitHubMergePollerService` automatically checks GitHub pull request merge status at configurable intervals and broadcasts updates via WebSocket to connected clients.

## Features

- **Background Polling**: Automatically polls GitHub API every 10 minutes (configurable)
- **Rate Limiting**: Respects GitHub API rate limits with exponential backoff retry logic
- **WebSocket Broadcasting**: Real-time updates to connected dashboard clients
- **Batch Processing**: Efficiently processes multiple projects in batches
- **Error Handling**: Graceful error handling that doesn't stop the service
- **Configurable**: Environment variable configuration with runtime updates

## Configuration

Environment variables:

- `GITHUB_MERGE_POLLING_ENABLED`: Enable/disable polling (default: `true`)
- `GITHUB_MERGE_POLL_INTERVAL_MINUTES`: Polling interval in minutes (default: `10`)
- `GITHUB_TOKEN`: GitHub API token (required for polling)

## API Endpoints

### Get Polling Status
```
GET /api/github/polling/status
```

Returns current polling service status and configuration.

### Trigger Manual Poll
```
POST /api/github/polling/trigger
```

Manually trigger a polling cycle for all projects.

### Update Configuration
```
PUT /api/github/polling/config
{
  "intervalMinutes": 15,
  "enabled": true
}
```

Update polling configuration at runtime.

## WebSocket Events

The service broadcasts the following events to `/ws/projects`:

### merge-status-updated
Fired when an individual project's merge status is updated:
```typescript
{
  type: 'merge-status-updated',
  payload: {
    projectId: string,
    mergeStatus: IMergeStatusData | null,
    timestamp: string
  }
}
```

### merge-status-poll-completed
Fired when a polling cycle completes:
```typescript
{
  type: 'merge-status-poll-completed',
  payload: {
    totalProjects: number,
    successfulUpdates: number,
    failedUpdates: number,
    timestamp: string
  }
}
```

### merge-status-poll-error
Fired when a polling cycle encounters an error:
```typescript
{
  type: 'merge-status-poll-error',
  payload: {
    error: string,
    timestamp: string
  }
}
```

## Integration

### Backend Integration

The service is automatically initialized in `main.ts`:

```typescript
import { gitHubMergePollerService } from './modules/github/github-merge-poller.service';

// In bootstrap()
await gitHubMergePollerService.init();

// In graceful shutdown
await gitHubMergePollerService.shutdown();
```

### Frontend Integration

The dashboard automatically listens for merge status events via `useProjectsSocket()`:

```typescript
// Events are automatically handled in hooks/use-projects-socket.ts
ws.on('merge-status-updated', (data) => {
  // Updates project store with new merge status
});
```

## Architecture

### Service Flow
1. **Initialization**: Service starts with configured interval
2. **Project Discovery**: Finds all projects with GitHub URLs
3. **Batch Processing**: Groups projects for efficient API usage  
4. **GitHub API Calls**: Fetches merge status using existing GitHub service
5. **Database Updates**: Updates project merge status in database
6. **WebSocket Broadcasting**: Notifies connected clients of updates

### Error Handling
- **Rate Limiting**: Automatic retry with exponential backoff
- **Network Errors**: Retries with configurable delay
- **Individual Failures**: Logged but don't stop the polling cycle
- **Service Failures**: Polling continues on next interval

### Dependencies
- `githubService`: For GitHub API interactions
- `projectsService`: For database updates and project queries
- `projectsWs`: For WebSocket broadcasting
- Database access for project queries

## Testing

To test the service:

1. **Manual Trigger**: `POST /api/github/polling/trigger`
2. **Check Status**: `GET /api/github/polling/status` 
3. **Monitor Logs**: Watch console for polling activity
4. **WebSocket Events**: Monitor browser console for events

## Performance Considerations

- **Batch Size**: Processes all eligible projects in a single batch
- **Rate Limiting**: Built-in GitHub API rate limit handling
- **Memory Usage**: Minimal - only stores configuration state
- **Database Impact**: Uses existing optimized project queries
- **Network Traffic**: Only polls projects with GitHub URLs
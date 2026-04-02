# Merge Status Frontend Implementation

This document describes the implementation of merge status indicators in the frontend components.

## Implementation Overview

The merge status indicators provide visual feedback for GitHub Pull Request status directly in the project list UI. The implementation consists of several key components:

### 1. MergeStatusIcon Component (`merge-status-icon.tsx`)

A React component that displays appropriate icons and tooltips based on merge status data.

**Features:**
- Uses Lucide React icons for consistency with existing UI patterns
- Provides tooltips with descriptive status information
- Handles all merge status states with appropriate visual indicators
- Returns null for unknown states (no icon displayed)

**Supported States:**
- ✅ **Green Check** (`Check`): Ready to merge - mergeable with passing checks
- ⚠️ **Yellow Warning** (`AlertTriangle`): Cannot merge - conflicts, failing checks, or pending checks
- 🔄 **Blue Sync** (`RotateCw`): Behind base branch by N commits
- ✔️ **Purple Merged** (`CheckCheck`): PR has been merged
- ❌ **Gray X** (`X`): PR is closed (not merged)
- **No Icon**: Unknown status or unavailable data

### 2. Updated Project Interface (`api/client.ts`)

Extended the `Project` interface to include merge status data:

```typescript
export interface MergeStatusData {
  mergeable: boolean | null;
  mergeable_state: string;
  checks_status: 'pending' | 'success' | 'failure' | 'neutral';
  merge_behind_by: number;
  last_checked: string;
  pr_state: 'open' | 'closed' | 'merged';
}

export interface Project {
  // ... existing fields
  mergeStatus: MergeStatusData | null;
}
```

### 3. Enhanced RepoInfo Component (`project-list.tsx`)

Updated the `RepoInfo` component to display merge status icons:

- Only shows merge status for Pull Request projects (not issues)
- Integrates seamlessly with existing GitHub context display
- Positioned after the PR title with proper spacing

**Visual Layout:**
```
🍴 owner/repo · 🔵 #123 PR Title · ✅
```

### 4. Projects Store Integration (`projects-store.ts`)

Added support for merge status updates:

- New `setProjectMergeStatus` action for updating individual project merge status
- TypeScript typing support for `MergeStatusData`
- Integration with existing project update patterns

### 5. WebSocket Integration (`use-projects-socket.ts`)

The WebSocket hook already handles merge status update events:

- `merge-status-updated`: Individual project status updates
- `merge-status-poll-completed`: Polling cycle completion
- `merge-status-poll-error`: Error notifications

Real-time updates automatically refresh the UI when merge status changes.

## Design Decisions

### Icon Choices
- **Consistency**: Uses existing Lucide React icon set
- **Semantic Meaning**: Icons convey clear meaning (check = good, warning = caution, sync = update needed)
- **Color Coding**: Follows established color patterns (green = success, yellow = warning, red = error, blue = info)

### Tooltip Information
- **Descriptive**: Clear explanation of what each status means
- **Actionable**: Provides context for what actions might be needed
- **Consistent**: Follows existing tooltip patterns using HTML `title` attribute

### Conditional Display
- **Context Aware**: Only shows for PR projects with merge status data
- **Graceful Degradation**: No visual impact when data is unavailable
- **Performance**: Minimal rendering impact with early returns for null states

## Testing

### Demo Page
A comprehensive demo page is available at `/merge-status-demo` showing all possible states:

- Visual verification of all icon states
- Tooltip testing for each status
- Color and sizing validation
- Integration with existing design system

### TypeScript Safety
- Full type safety for merge status data
- Compile-time validation of all components
- Interface consistency across frontend and backend

## Usage Examples

### Basic Usage
```tsx
import { MergeStatusIcon } from './merge-status-icon';

<MergeStatusIcon mergeStatus={project.mergeStatus} />
```

### In RepoInfo Component
```tsx
{isPr && mergeStatus && (
  <>
    <span className="text-text-muted/50">·</span>
    <MergeStatusIcon mergeStatus={mergeStatus} />
  </>
)}
```

## Integration Points

### Existing Components
- **ProjectList**: Main integration point for displaying icons
- **RepoInfo**: Enhanced to show merge status
- **ProjectCard**: Displays merge status within project cards

### State Management
- **Projects Store**: Handles merge status data and updates
- **WebSocket Hook**: Receives real-time merge status updates
- **API Client**: Typed interfaces for merge status data

## Future Enhancements

Potential improvements for future iterations:

1. **Status Age Indicators**: Show how recently status was checked
2. **Interactive Actions**: Click to refresh status or view detailed checks
3. **Batch Status Updates**: Visual feedback during polling cycles
4. **Status History**: Track merge status changes over time
5. **Custom Status Rules**: User-configurable status interpretation

## Performance Considerations

- **Lazy Loading**: Icons only render when merge status data is available
- **Minimal Re-renders**: Uses React optimization patterns
- **Bundle Size**: Small impact using existing icon library
- **Memory Usage**: Efficient data structures for merge status

## Conclusion

The merge status frontend implementation provides a seamless, intuitive way for users to quickly assess the state of their Pull Requests without leaving the project list view. The implementation follows established patterns, maintains type safety, and integrates smoothly with the existing codebase architecture.
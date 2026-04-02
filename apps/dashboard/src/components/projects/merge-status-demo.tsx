import { MergeStatusIcon, type MergeStatusData } from './merge-status-icon';

// Demo data for testing all merge status states
const testStatuses: Array<{ name: string; status: MergeStatusData }> = [
  {
    name: 'Ready to merge (green check)',
    status: {
      mergeable: true,
      mergeable_state: 'clean',
      checks_status: 'success',
      merge_behind_by: 0,
      last_checked: new Date().toISOString(),
      pr_state: 'open',
    },
  },
  {
    name: 'Merge conflicts (yellow warning)',
    status: {
      mergeable: false,
      mergeable_state: 'dirty',
      checks_status: 'success',
      merge_behind_by: 0,
      last_checked: new Date().toISOString(),
      pr_state: 'open',
    },
  },
  {
    name: 'Failing checks (yellow warning)',
    status: {
      mergeable: true,
      mergeable_state: 'clean',
      checks_status: 'failure',
      merge_behind_by: 0,
      last_checked: new Date().toISOString(),
      pr_state: 'open',
    },
  },
  {
    name: 'Behind base branch (blue sync)',
    status: {
      mergeable: true,
      mergeable_state: 'behind',
      checks_status: 'success',
      merge_behind_by: 3,
      last_checked: new Date().toISOString(),
      pr_state: 'open',
    },
  },
  {
    name: 'Pending checks (yellow warning)',
    status: {
      mergeable: true,
      mergeable_state: 'clean',
      checks_status: 'pending',
      merge_behind_by: 0,
      last_checked: new Date().toISOString(),
      pr_state: 'open',
    },
  },
  {
    name: 'PR merged (purple merged)',
    status: {
      mergeable: null,
      mergeable_state: 'clean',
      checks_status: 'success',
      merge_behind_by: 0,
      last_checked: new Date().toISOString(),
      pr_state: 'merged',
    },
  },
  {
    name: 'PR closed (gray X)',
    status: {
      mergeable: null,
      mergeable_state: 'clean',
      checks_status: 'success',
      merge_behind_by: 0,
      last_checked: new Date().toISOString(),
      pr_state: 'closed',
    },
  },
  {
    name: 'Unknown state (no icon)',
    status: {
      mergeable: null,
      mergeable_state: 'unknown',
      checks_status: 'neutral',
      merge_behind_by: 0,
      last_checked: new Date().toISOString(),
      pr_state: 'open',
    },
  },
];

export function MergeStatusDemo() {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Merge Status Icon Demo</h1>
      
      <div className="space-y-4">
        {testStatuses.map((test, index) => (
          <div
            key={index}
            className="flex items-center gap-3 p-4 border border-border rounded-lg bg-surface"
          >
            <MergeStatusIcon mergeStatus={test.status} className="w-4 h-4" />
            <span className="text-sm">{test.name}</span>
          </div>
        ))}
      </div>

      <div className="mt-8 p-4 border border-border rounded-lg bg-surface-secondary">
        <h2 className="text-lg font-semibold mb-2">Usage</h2>
        <p className="text-sm text-text-secondary">
          These icons will appear next to GitHub pull request links in the project list when merge status data is available.
          They provide a quick visual indication of whether the PR is ready to merge, has issues, or is in a specific state.
        </p>
      </div>
    </div>
  );
}
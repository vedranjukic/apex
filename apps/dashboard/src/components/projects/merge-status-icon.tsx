import { 
  Check, 
  AlertTriangle, 
  RotateCw, 
  CheckCheck, 
  X 
} from 'lucide-react';
import { cn } from '../../lib/cn';

export interface MergeStatusData {
  mergeable: boolean | null;
  mergeable_state: string;
  checks_status: 'pending' | 'success' | 'failure' | 'neutral';
  merge_behind_by: number;
  last_checked: string;
  pr_state: 'open' | 'closed' | 'merged';
}

interface MergeStatusIconProps {
  mergeStatus: MergeStatusData;
  className?: string;
}

function getMergeStatusInfo(status: MergeStatusData) {
  // PR already merged - purple merged icon
  if (status.pr_state === 'merged') {
    return {
      icon: CheckCheck,
      color: 'text-purple-400',
      label: 'PR merged',
      tooltip: 'Pull request has been merged'
    };
  }

  // PR closed (not merged) - gray X
  if (status.pr_state === 'closed') {
    return {
      icon: X,
      color: 'text-text-muted',
      label: 'PR closed',
      tooltip: 'Pull request is closed (not merged)'
    };
  }

  // For open PRs, determine status based on mergeability and checks
  
  // Behind base branch - blue sync icon
  if (status.merge_behind_by > 0) {
    return {
      icon: RotateCw,
      color: 'text-blue-400',
      label: 'Behind base',
      tooltip: `Behind base branch by ${status.merge_behind_by} commit${status.merge_behind_by !== 1 ? 's' : ''}`
    };
  }

  // Conflicts or failing checks - yellow warning
  if (status.mergeable === false || status.checks_status === 'failure') {
    const reasons = [];
    if (status.mergeable === false) reasons.push('merge conflicts');
    if (status.checks_status === 'failure') reasons.push('failing checks');
    
    return {
      icon: AlertTriangle,
      color: 'text-yellow-400',
      label: 'Cannot merge',
      tooltip: `Cannot merge: ${reasons.join(' and ')}`
    };
  }

  // Mergeable with passing checks - green check
  if (status.mergeable === true && status.checks_status === 'success') {
    return {
      icon: Check,
      color: 'text-green-400',
      label: 'Ready to merge',
      tooltip: 'Ready to merge - checks passing'
    };
  }

  // Pending checks - yellow warning
  if (status.checks_status === 'pending') {
    return {
      icon: AlertTriangle,
      color: 'text-yellow-400',
      label: 'Checks pending',
      tooltip: 'Waiting for status checks to complete'
    };
  }

  // Unknown state - no icon (return null to indicate no icon should be shown)
  return null;
}

export function MergeStatusIcon({ mergeStatus, className }: MergeStatusIconProps) {
  const statusInfo = getMergeStatusInfo(mergeStatus);
  
  // Don't render anything if status is unknown or no icon should be shown
  if (!statusInfo) {
    return null;
  }

  const Icon = statusInfo.icon;
  
  return (
    <Icon 
      className={cn('w-3 h-3 shrink-0', statusInfo.color, className)}
      title={statusInfo.tooltip}
    />
  );
}
import { create } from 'zustand';

export const BUILD_PROMPT_PREFIX = 'Execute the following plan:\n\n';

/** Delimiter for plan blocks - agent in plan mode must wrap plans in these for 100% detection */
export const PLAN_BLOCK_START = '```plan';
export const PLAN_BLOCK_END = '```';

/** Regex to extract plan content from fenced ```plan ... ``` blocks.
 * Note: The standard *? non-greedy match stops at the first ```, which truncates
 * content when the plan has nested code blocks (e.g. Project Structure directory tree).
 * extractPlanBody uses a custom parser to handle nesting. */
export const PLAN_BLOCK_REGEX = /```plan\s*\n?([\s\S]*?)```/;

export interface Plan {
  id: string;
  threadId: string;
  title: string;
  filename: string;
  content: string;
  isComplete: boolean;
  createdAt: string;
}

interface PlanState {
  plans: Plan[];
  planThreadIds: Set<string>;

  markThreadAsPlan: (threadId: string) => void;
  isThreadPlan: (threadId: string) => boolean;
  createPlan: (threadId: string, content: string) => Plan | null;
  updatePlanContent: (planId: string, content: string) => void;
  completePlan: (planId: string) => void;
  getPlanByThreadId: (threadId: string) => Plan | undefined;
  getPlanById: (planId: string) => Plan | undefined;
}

/**
 * Extract plan content from text. Uses the deterministic ```plan ... ``` delimiter.
 * Handles nested code blocks (e.g. Project Structure directory tree in ```) by
 * using the LAST ``` as the closing delimiter; the regex *? would truncate at the first.
 * Returns null if no plan block is found.
 */
export function extractPlanBody(raw: string): string | null {
  const startMarker = '```plan';
  const idx = raw.indexOf(startMarker);
  if (idx < 0) return null;

  const afterStart = raw.slice(idx + startMarker.length).replace(/^\s*\n?/, '');
  const lastFence = afterStart.lastIndexOf('```');
  const content = lastFence >= 0 ? afterStart.slice(0, lastFence) : afterStart;
  return content.trim() || null;
}

export function extractTitle(markdown: string): string {
  const headingMatch = markdown.match(/^#{1,3}\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();

  const firstLine = markdown.trim().split('\n')[0];
  if (firstLine && firstLine.length > 0) {
    return firstLine.replace(/^[#*_\->\s]+/, '').slice(0, 60);
  }
  return 'Untitled Plan';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

export function generateFilename(title: string): string {
  const slug = slugify(title);
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace('T', 'T').slice(0, 13);
  return `${slug}_${ts}.md`;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  plans: [],
  planThreadIds: new Set(),

  markThreadAsPlan: (threadId) => {
    set((state) => {
      const next = new Set(state.planThreadIds);
      next.add(threadId);
      return { planThreadIds: next };
    });
  },

  isThreadPlan: (threadId) => get().planThreadIds.has(threadId),

  createPlan: (threadId, rawContent) => {
    const existing = get().plans.find((p) => p.threadId === threadId);
    if (existing) {
      get().updatePlanContent(existing.id, rawContent);
      return existing;
    }

    const content = extractPlanBody(rawContent) || rawContent.trim();
    if (!content) return null;

    const title = extractTitle(content);
    const plan: Plan = {
      id: crypto.randomUUID(),
      threadId,
      title,
      filename: generateFilename(title),
      content,
      isComplete: false,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({ plans: [...state.plans, plan] }));
    return plan;
  },

  updatePlanContent: (planId, rawContent) => {
    const content = extractPlanBody(rawContent) || rawContent.trim();
    if (!content) return;
    set((state) => ({
      plans: state.plans.map((p) => {
        if (p.id !== planId) return p;
        const newTitle = extractTitle(content);
        const titleChanged = newTitle !== p.title;
        return {
          ...p,
          content,
          title: newTitle,
          filename: titleChanged ? generateFilename(newTitle) : p.filename,
        };
      }),
    }));
  },

  completePlan: (planId) => {
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId ? { ...p, isComplete: true } : p,
      ),
    }));
  },

  getPlanByThreadId: (threadId) => get().plans.find((p) => p.threadId === threadId),

  getPlanById: (planId) => get().plans.find((p) => p.id === planId),
}));

import { create } from 'zustand';

export const BUILD_PROMPT_PREFIX = 'Execute the following plan:\n\n';

export interface Plan {
  id: string;
  chatId: string;
  title: string;
  filename: string;
  content: string;
  isComplete: boolean;
  createdAt: string;
}

interface PlanState {
  plans: Plan[];
  planChatIds: Set<string>;

  markChatAsPlan: (chatId: string) => void;
  isChatPlan: (chatId: string) => boolean;
  createPlan: (chatId: string, content: string) => Plan | null;
  updatePlanContent: (planId: string, content: string) => void;
  completePlan: (planId: string) => void;
  getPlanByChatId: (chatId: string) => Plan | undefined;
  getPlanById: (planId: string) => Plan | undefined;
}

const MIN_PLAN_LENGTH = 150;

/** Plan-like section headers (match at line start; content may follow on same line) */
const PLAN_INDICATORS = [
  /(?:^|\n)\s*Plan\s*:/i,
  /(?:^|\n)\s*Implementation\s+plan\s*:?/i,
  /(?:^|\n)\s*File\s+structure\s*:?/i,
  /(?:^|\n)\s*Structure\s*:?/i,
  /(?:^|\n)\s*Stack\s*:?/i,
  /(?:^|\n)\s*Styling\s*:?/i,
  /(?:^|\n)\s*Storage\s*:?/i,
  /(?:^|\n)\s*Features\s*:?/i,
  /(?:^|\n)\s*Details\s*:?/i,
  /(?:^|\n)\s*Here'?s\s+the\s+plan\b/i,
  /(?:^|\n)\s*Here'?s\s+my\s+plan\b/i,
  /(?:^|\n)\s*Here'?s\s+what\s+I'?ll\s+build\b/i,
  /\bShall\s+I\s+proceed\b/i,
];

/**
 * Strip conversational preamble — return only the portion from the first
 * markdown heading or plan section onward.  If neither is found but the
 * text is long enough, return the full text (some plans use plain-text).
 * Returns null only when the content is too short to be a real plan.
 */
function extractPlanBody(raw: string): string | null {
  const headingIdx = raw.search(/^#{1,3}\s+/m);
  let idx = headingIdx >= 0 ? headingIdx : -1;
  for (const r of PLAN_INDICATORS) {
    const m = raw.match(r);
    if (m && m.index !== undefined) {
      idx = idx >= 0 ? Math.min(idx, m.index) : m.index;
    }
  }
  if (idx < 0) {
    const fallbacks = [
      /\bHere'?s\s+what\s+I'?ll\s+build\b/i,
      /\bPlan\s*:\s*/i,
      /\bStack\s*:\s*/i,
      /\bFeatures\s*:\s*/i,
    ];
    for (const r of fallbacks) {
      const m = raw.match(r);
      if (m && m.index !== undefined) {
        idx = idx >= 0 ? Math.min(idx, m.index) : m.index;
      }
    }
  }
  if (idx >= 0) return raw.slice(idx);
  if (raw.length >= MIN_PLAN_LENGTH) return raw;
  return null;
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
  planChatIds: new Set(),

  markChatAsPlan: (chatId) => {
    set((state) => {
      const next = new Set(state.planChatIds);
      next.add(chatId);
      return { planChatIds: next };
    });
  },

  isChatPlan: (chatId) => get().planChatIds.has(chatId),

  createPlan: (chatId, rawContent) => {
    const existing = get().plans.find((p) => p.chatId === chatId);
    if (existing) {
      get().updatePlanContent(existing.id, rawContent);
      return existing;
    }

    const content = extractPlanBody(rawContent);
    if (!content) return null;

    const title = extractTitle(content);
    const plan: Plan = {
      id: crypto.randomUUID(),
      chatId,
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
    const content = extractPlanBody(rawContent);
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

  getPlanByChatId: (chatId) => get().plans.find((p) => p.chatId === chatId),

  getPlanById: (planId) => get().plans.find((p) => p.id === planId),
}));

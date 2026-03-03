const DEFAULT_GIT_FILES_DISPLAY_LIMIT = 100;
const LOCAL_STORAGE_KEY = 'git_files_display_limit';

/**
 * Returns the maximum number of changed files to display in the source control panel.
 * When exceeded, a warning with AI .gitignore analysis is shown instead.
 * Can be overridden via localStorage key "git_files_display_limit".
 */
export function getGitFilesDisplayLimit(): number {
  if (typeof window === 'undefined') return DEFAULT_GIT_FILES_DISPLAY_LIMIT;
  const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (stored === null) return DEFAULT_GIT_FILES_DISPLAY_LIMIT;
  const parsed = parseInt(stored, 10);
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_GIT_FILES_DISPLAY_LIMIT : parsed;
}

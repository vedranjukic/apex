/**
 * Open a project — focuses an existing window/tab if one is already
 * showing that project, otherwise opens a new one.
 *
 * In desktop (Electrobun): uses `focusOrOpenWindow` RPC which checks
 * all BrowserWindows by URL in the main process.
 * In browsers: uses `window.open(url, name)` which reuses tabs
 * with the same window name.
 */
export function openProject(projectId: string): void {
  const url = `/projects/${projectId}`;
  const apexBridge = (window as any).apex;

  if (apexBridge?.focusOrOpenWindow) {
    apexBridge.focusOrOpenWindow(url);
  } else {
    window.open(url, `project-${projectId}`);
  }
}

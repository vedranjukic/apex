/**
 * Daytona WebSocket Orchestrator
 *
 * Coordinate multiple Claude Code instances running in parallel Daytona sandboxes
 * using the --sdk-url WebSocket protocol.
 *
 * @example
 * ```typescript
 * import { DaytonaWebSocketOrchestrator } from './orchestrator.js';
 *
 * const orchestrator = new DaytonaWebSocketOrchestrator({
 *   wsPort: 9000,
 *   anthropicApiKey: process.env.ANTHROPIC_API_KEY,
 * });
 *
 * await orchestrator.initialize();
 *
 * const results = await orchestrator.executeTasks([
 *   { id: '1', name: 'Frontend', prompt: 'Build a React app...' },
 *   { id: '2', name: 'Backend', prompt: 'Build an Express API...' },
 * ]);
 *
 * await orchestrator.cleanup();
 * ```
 */

export { DaytonaWebSocketOrchestrator } from './orchestrator.js';
export * from './types.js';

/**
 * Live Feed Display for WebSocket Orchestrator
 * 
 * Shows real-time streaming output from parallel Claude instances
 * with colored, formatted terminal output.
 */

import chalk from 'chalk';

const COLORS: Record<string, typeof chalk> = {
  Frontend: chalk.cyan,
  Backend: chalk.yellow,
  Tests: chalk.magenta,
  Database: chalk.green,
  Default: chalk.white,
};

const TOOL_ICONS: Record<string, string> = {
  Bash: '⚡',
  Write: '📝',
  Edit: '✏️',
  Read: '👁️',
  TodoWrite: '📋',
  WebFetch: '🌐',
  WebSearch: '🔍',
  Glob: '📂',
  Grep: '🔎',
  Task: '🤖',
};

interface FeedEntry {
  time: string;
  task: string;
  type: 'text' | 'tool' | 'result' | 'system' | 'error' | 'status';
  content: string;
}

export class LiveFeed {
  private entries: FeedEntry[] = [];
  private taskStatus: Map<string, { status: string; elapsed: number; tools: number; lastActivity: string }> = new Map();
  private startTime: number = Date.now();
  private statusInterval: NodeJS.Timeout | null = null;

  start() {
    this.startTime = Date.now();
    // Print status bar every 5 seconds
    this.statusInterval = setInterval(() => this.printStatusBar(), 5000);
    this.printHeader();
  }

  stop() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
  }

  /**
   * Process a bridge message for a task
   */
  onMessage(taskName: string, msg: any) {
    // Initialize task status
    if (!this.taskStatus.has(taskName)) {
      this.taskStatus.set(taskName, { status: '⏳ Working', elapsed: 0, tools: 0, lastActivity: '' });
    }
    const ts = this.taskStatus.get(taskName)!;

    if (msg.type === 'bridge_ready') {
      this.emit(taskName, 'system', '🔗 Bridge connected');
    } else if (msg.type === 'claude_message' && msg.data) {
      this.handleClaudeMessage(taskName, msg.data);
    } else if (msg.type === 'claude_stdout') {
      this.handleClaudeStdout(taskName, msg.data);
    } else if (msg.type === 'claude_exit') {
      ts.status = msg.code === 0 ? '✅ Done' : '❌ Failed';
      this.emit(taskName, msg.code === 0 ? 'result' : 'error', 
        msg.code === 0 ? '🏁 Task completed' : `❌ Exited with code ${msg.code}`);
    } else if (msg.type === 'claude_error') {
      ts.status = '❌ Error';
      this.emit(taskName, 'error', `❌ ${msg.error}`);
    }
  }

  private handleClaudeMessage(taskName: string, msg: any) {
    const ts = this.taskStatus.get(taskName)!;

    if (msg.type === 'system' && msg.subtype === 'init') {
      this.emit(taskName, 'system', `⚙️ Claude ${msg.claude_code_version} | ${msg.model} | ${msg.tools?.length || 0} tools`);
    } else if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) {
          // Show meaningful text (skip very short)
          const text = block.text.trim();
          if (text.length > 15) {
            this.emit(taskName, 'text', text);
            ts.lastActivity = text.slice(0, 40);
          }
        } else if (block.type === 'tool_use') {
          ts.tools++;
          const icon = TOOL_ICONS[block.name] || '🔧';
          const input = this.formatToolInput(block.name, block.input);
          this.emit(taskName, 'tool', `${icon} ${block.name}${input ? ': ' + input : ''}`);
          ts.lastActivity = `${block.name}`;
        }
      }
    } else if (msg.type === 'result') {
      ts.status = msg.is_error ? '❌ Failed' : '✅ Done';
      const cost = msg.total_cost_usd ? `$${msg.total_cost_usd.toFixed(4)}` : '';
      const turns = msg.num_turns || 0;
      this.emit(taskName, 'result', `🏁 Done in ${turns} turns ${cost}`);
    }
  }

  private handleClaudeStdout(taskName: string, output: string) {
    const lines = output.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        this.handleClaudeMessage(taskName, msg);
      } catch {
        // Raw output
      }
    }
  }

  private formatToolInput(name: string, input: any): string {
    if (!input) return '';
    if (name === 'Bash') return input.command?.slice(0, 50) || '';
    if (name === 'Write') return input.file_path || '';
    if (name === 'Edit') return input.file_path || '';
    if (name === 'Read') return input.file_path || '';
    if (name === 'Glob') return input.pattern || '';
    if (name === 'Grep') return input.pattern || '';
    return '';
  }

  private emit(taskName: string, type: FeedEntry['type'], content: string) {
    const time = this.elapsed();
    const entry: FeedEntry = { time, task: taskName, type, content };
    this.entries.push(entry);
    this.printEntry(entry);
  }

  private printHeader() {
    console.log();
    console.log(chalk.bold.white('  ╔══════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.white('  ║') + chalk.bold.cyan('          LIVE AGENT FEED - Real-time Streaming          ') + chalk.bold.white('║'));
    console.log(chalk.bold.white('  ╚══════════════════════════════════════════════════════════╝'));
    console.log();
  }

  private printEntry(entry: FeedEntry) {
    const color = COLORS[entry.task] || COLORS.Default;
    const tag = color(`[${entry.task}]`);
    const time = chalk.gray(entry.time);

    switch (entry.type) {
      case 'text':
        console.log(`  ${time} ${tag} ${chalk.white(entry.content.slice(0, 80))}`);
        break;
      case 'tool':
        console.log(`  ${time} ${tag} ${chalk.yellow(entry.content)}`);
        break;
      case 'result':
        console.log(`  ${time} ${tag} ${chalk.green(entry.content)}`);
        break;
      case 'error':
        console.log(`  ${time} ${tag} ${chalk.red(entry.content)}`);
        break;
      case 'system':
        console.log(`  ${time} ${tag} ${chalk.gray(entry.content)}`);
        break;
      case 'status':
        console.log(`  ${time} ${tag} ${chalk.blue(entry.content)}`);
        break;
    }
  }

  private printStatusBar() {
    const elapsed = this.elapsed();
    const tasks = Array.from(this.taskStatus.entries());
    
    if (tasks.length === 0) return;

    const parts = tasks.map(([name, ts]) => {
      const color = COLORS[name] || COLORS.Default;
      return `${color(name)}: ${ts.status} (${ts.tools} tools)`;
    });

    console.log(chalk.gray(`  ─── ${elapsed} ─── `) + parts.join(chalk.gray(' │ ')) + chalk.gray(' ───'));
  }

  printSummary(results: Array<{ taskName: string; status: string; durationMs: number; costUsd?: number }>) {
    console.log();
    console.log(chalk.bold.white('  ╔══════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.white('  ║') + chalk.bold.green('                     RESULTS SUMMARY                      ') + chalk.bold.white('║'));
    console.log(chalk.bold.white('  ╚══════════════════════════════════════════════════════════╝'));
    console.log();

    for (const r of results) {
      const color = COLORS[r.taskName] || COLORS.Default;
      const icon = r.status === 'success' ? '✅' : '❌';
      const dur = (r.durationMs / 1000).toFixed(1);
      const cost = r.costUsd ? `$${r.costUsd.toFixed(4)}` : '';
      const ts = this.taskStatus.get(r.taskName);
      const tools = ts ? `${ts.tools} tools` : '';
      
      console.log(`  ${icon} ${color(r.taskName.padEnd(12))} ${chalk.gray(`${dur}s`)}  ${chalk.gray(cost)}  ${chalk.gray(tools)}`);
    }
    console.log();
  }

  private elapsed(): string {
    const ms = Date.now() - this.startTime;
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}

import chalk from 'chalk';
import { configManager } from '../config/index.js';

/**
 * Check if API keys are configured and show error message if not
 */
export function checkApiKeys(): boolean {
  const config = configManager.config;
  
  if (!config.anthropicApiKey || !config.daytonaApiKey) {
    console.error(chalk.red('API keys not configured. Run "apex configure" to set them up.'));
    console.error(chalk.gray(`Database: ${config.dbPath}`));
    return false;
  }
  
  return true;
}

/**
 * Check if we're in interactive mode (not piped)
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

/**
 * Generate a short ID from a longer ID
 */
export function shortId(id: string, length: number = 8): string {
  return id.length > length ? id.slice(0, length) : id;
}

/**
 * Format a date string for display
 */
export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit' 
    });
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: diffDays > 365 ? 'numeric' : undefined 
    });
  }
}

/**
 * Get color for status display
 */
export function getStatusColor(status: string) {
  switch (status) {
    case 'running':
    case 'active':
      return chalk.green;
    case 'creating':
    case 'starting':
      return chalk.yellow;
    case 'completed':
      return chalk.blue;
    case 'stopped':
      return chalk.gray;
    case 'error':
      return chalk.red;
    default:
      return chalk.white;
  }
}

/**
 * Mask sensitive keys for display
 */
export function maskKey(key?: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '…' + key.slice(-4);
}

/**
 * Validate provider
 */
export function isValidProvider(provider: string): provider is 'daytona' | 'docker' | 'local' | 'apple-container' {
  return ['daytona', 'docker', 'local', 'apple-container'].includes(provider);
}

/**
 * Validate agent type
 */
export function isValidAgentType(agentType: string): agentType is 'build' | 'plan' | 'sisyphus' {
  return ['build', 'plan', 'sisyphus'].includes(agentType);
}

/**
 * Simple spinner utility
 */
export class Spinner {
  private chars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private index = 0;
  private interval?: NodeJS.Timeout;
  private text: string;

  constructor(text: string = 'Loading...') {
    this.text = text;
  }

  start(): void {
    this.interval = setInterval(() => {
      process.stdout.write(`\r${chalk.cyan(this.chars[this.index])} ${this.text}`);
      this.index = (this.index + 1) % this.chars.length;
    }, 100);
  }

  updateText(text: string): void {
    this.text = text;
  }

  stop(success: boolean = true, finalText?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    
    const symbol = success ? chalk.green('✓') : chalk.red('✗');
    process.stdout.write(`\r${symbol} ${finalText || this.text}\n`);
  }
}
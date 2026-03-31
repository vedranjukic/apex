import { SandboxManager, type OrchestratorConfig } from '@apex/orchestrator';
import type { Project, BridgeMessage, AgentOutput } from '../types/index.js';
import { configManager } from '../config/index.js';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';

export interface CliSandboxCallbacks {
  onStatusChange?: (status: string) => void;
  onMessage?: (message: AgentOutput) => void;
  onProgress?: (message: string) => void;
  onError?: (error: Error) => void;
}

export class CliSandboxManager {
  private sandboxManager: SandboxManager;
  private spinner: Ora | null = null;
  private callbacks: CliSandboxCallbacks = {};
  private initialized = false;

  constructor() {
    const config = configManager.config;
    
    // Initialize SandboxManager with CLI-appropriate configuration
    const orchestratorConfig: Partial<OrchestratorConfig> = {
      anthropicApiKey: config.anthropicApiKey,
      openaiApiKey: config.openaiApiKey,
      provider: config.defaultProvider,
    };

    this.sandboxManager = new SandboxManager(orchestratorConfig);
  }

  public setCallbacks(callbacks: CliSandboxCallbacks): void {
    this.callbacks = callbacks;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.sandboxManager.initialize();
      this.initialized = true;
    }
  }

  public async createSandbox(project: Project): Promise<string> {
    await this.ensureInitialized();
    this.startSpinner(`Creating ${project.provider} sandbox for ${project.name}...`);
    
    try {
      const onStatusChange = (status: string) => {
        this.updateSpinner(`Creating sandbox: ${status}`);
        this.callbacks.onStatusChange?.(status);
      };

      const sandboxId = await this.sandboxManager.createSandbox(
        undefined, // snapshot - will use default
        project.name,
        project.gitRepo,
        project.agentType,
        project.id,
        onStatusChange,
        project.localDir
      );

      this.stopSpinner(true, `Sandbox created: ${sandboxId}`);
      return sandboxId;
    } catch (error) {
      this.stopSpinner(false, 'Failed to create sandbox');
      throw error;
    }
  }

  public async connectToSandbox(sandboxId: string): Promise<void> {
    await this.ensureInitialized();
    this.startSpinner(`Connecting to sandbox ${sandboxId}...`);
    
    try {
      await this.sandboxManager.reconnectSandbox(sandboxId);
      this.stopSpinner(true, `Connected to sandbox ${sandboxId}`);
    } catch (error) {
      this.stopSpinner(false, 'Failed to connect to sandbox');
      throw error;
    }
  }

  public async sendPrompt(
    sandboxId: string,
    prompt: string,
    agentType: Project['agentType'] = 'build',
    model = 'claude-3-5-sonnet-20241022'
  ): Promise<void> {
    await this.ensureInitialized();
    this.startSpinner('Sending prompt to agent...');
    
    try {
      // Set up message handler for CLI output
      const messageHandler = (message: BridgeMessage) => {
        const output = this.parseBridgeMessage(message);
        if (output) {
          this.renderAgentOutput(output);
          this.callbacks.onMessage?.(output);
        }
      };

      await this.sandboxManager.sendPrompt(sandboxId, prompt, agentType, model, messageHandler);
      this.stopSpinner(true, 'Task completed');
    } catch (error) {
      this.stopSpinner(false, 'Task failed');
      throw error;
    }
  }

  public async destroySandbox(sandboxId: string): Promise<void> {
    await this.ensureInitialized();
    this.startSpinner(`Destroying sandbox ${sandboxId}...`);
    
    try {
      await this.sandboxManager.deleteSandbox(sandboxId);
      this.stopSpinner(true, `Sandbox ${sandboxId} destroyed`);
    } catch (error) {
      this.stopSpinner(false, 'Failed to destroy sandbox');
      throw error;
    }
  }

  public async getSandboxStatus(sandboxId: string): Promise<string> {
    await this.ensureInitialized();
    // This might need to be implemented differently based on the actual SandboxManager API
    return 'running'; // placeholder
  }

  public async getPreviewUrl(sandboxId: string, port: number): Promise<string> {
    await this.ensureInitialized();
    return this.sandboxManager.getPreviewUrl(sandboxId, port);
  }

  private parseBridgeMessage(message: BridgeMessage): AgentOutput | null {
    switch (message.type) {
      case 'claude_message':
        if (message.data.type === 'content_block_delta') {
          return {
            type: 'content',
            content: message.data.delta?.text || '',
          };
        } else if (message.data.type === 'tool_use') {
          return {
            type: 'tool_use',
            toolName: message.data.name,
            toolInput: message.data.input,
          };
        } else if (message.data.type === 'tool_result') {
          return {
            type: 'tool_result',
            toolResult: message.data.content,
            isError: message.data.is_error,
          };
        }
        break;
      
      case 'claude_error':
        return {
          type: 'error',
          content: message.data.error || 'Unknown error',
          isError: true,
        };
      
      default:
        return null;
    }
  }

  private renderAgentOutput(output: AgentOutput): void {
    this.stopSpinner();
    
    switch (output.type) {
      case 'content':
        // Stream content without newlines for natural flow
        process.stdout.write(output.content || '');
        break;
      
      case 'tool_use':
        console.log(chalk.blue(`\n🔧 Using tool: ${output.toolName}`));
        if (output.toolInput && Object.keys(output.toolInput).length > 0) {
          console.log(chalk.gray(JSON.stringify(output.toolInput, null, 2)));
        }
        break;
      
      case 'tool_result':
        if (output.isError) {
          console.log(chalk.red('❌ Tool error:'), output.toolResult);
        } else {
          console.log(chalk.green('✅ Tool result:'), 
            typeof output.toolResult === 'string' 
              ? output.toolResult 
              : JSON.stringify(output.toolResult, null, 2)
          );
        }
        break;
      
      case 'error':
        console.log(chalk.red('\n❌ Error:'), output.content);
        break;
    }
  }

  private startSpinner(text: string): void {
    if (this.spinner) {
      this.spinner.stop();
    }
    this.spinner = ora({
      text,
      color: 'cyan',
    }).start();
  }

  private updateSpinner(text: string): void {
    if (this.spinner) {
      this.spinner.text = text;
    }
  }

  private stopSpinner(success: boolean = true, text?: string): void {
    if (this.spinner) {
      if (success) {
        this.spinner.succeed(text);
      } else {
        this.spinner.fail(text);
      }
      this.spinner = null;
    }
  }

  public disconnect(): void {
    this.stopSpinner();
    // The SandboxManager doesn't have a direct disconnect method,
    // but we can close any open connections
  }

  // Proxy useful methods from the underlying SandboxManager
  public get availableProviders() {
    return ['daytona', 'docker', 'local', 'apple-container'] as const;
  }

  public async listSandboxes() {
    await this.ensureInitialized();
    return this.sandboxManager.listSandboxes();
  }

  public async getSandboxLogs(sandboxId: string) {
    await this.ensureInitialized();
    return this.sandboxManager.getSandboxLogs(sandboxId);
  }
}
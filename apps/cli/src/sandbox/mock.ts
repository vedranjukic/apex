import type { Project, AgentOutput } from '../types/index.js';
import chalk from 'chalk';

export interface CliSandboxCallbacks {
  onStatusChange?: (status: string) => void;
  onMessage?: (message: AgentOutput) => void;
  onProgress?: (message: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Mock SandboxManager for development and testing
 * This provides the same interface as the real CliSandboxManager 
 * but doesn't actually connect to sandboxes.
 */
export class MockSandboxManager {
  private callbacks: CliSandboxCallbacks = {};
  private mockSandboxes = new Map<string, { id: string; name: string; status: string }>();

  public setCallbacks(callbacks: CliSandboxCallbacks): void {
    this.callbacks = callbacks;
  }

  public async createSandbox(project: Project): Promise<string> {
    console.log(chalk.yellow('🚀 [Mock] Creating sandbox...'));
    
    // Simulate creation delay
    await this.delay(1000);
    
    const sandboxId = `mock-${project.id}-${Date.now()}`;
    this.mockSandboxes.set(sandboxId, {
      id: sandboxId,
      name: project.name,
      status: 'running'
    });

    console.log(chalk.green(`✅ [Mock] Sandbox created: ${sandboxId}`));
    this.callbacks.onStatusChange?.('running');
    
    return sandboxId;
  }

  public async connectToSandbox(sandboxId: string): Promise<void> {
    console.log(chalk.cyan(`🔗 [Mock] Connecting to sandbox ${sandboxId}...`));
    
    // Simulate connection delay
    await this.delay(500);
    
    const sandbox = this.mockSandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    console.log(chalk.green(`✅ [Mock] Connected to sandbox ${sandboxId}`));
    this.callbacks.onStatusChange?.('connected');
  }

  public async sendPrompt(
    sandboxId: string,
    prompt: string,
    agentType: Project['agentType'] = 'build',
    model = 'claude-3-5-sonnet-20241022'
  ): Promise<void> {
    console.log(chalk.blue(`🤖 [Mock] Sending prompt to ${agentType} agent...`));
    
    // Simulate agent thinking
    await this.delay(500);
    
    // Mock agent response
    const mockResponse = this.generateMockResponse(prompt, agentType);
    
    // Simulate streaming response
    for (const chunk of mockResponse) {
      await this.delay(50);
      this.callbacks.onMessage?.(chunk);
      this.renderAgentOutput(chunk);
    }

    console.log(chalk.green('\n✅ [Mock] Task completed'));
  }

  public async destroySandbox(sandboxId: string): Promise<void> {
    console.log(chalk.yellow(`🗑️  [Mock] Destroying sandbox ${sandboxId}...`));
    
    // Simulate destruction delay
    await this.delay(500);
    
    this.mockSandboxes.delete(sandboxId);
    console.log(chalk.green(`✅ [Mock] Sandbox ${sandboxId} destroyed`));
  }

  public async getSandboxStatus(sandboxId: string): Promise<string> {
    const sandbox = this.mockSandboxes.get(sandboxId);
    return sandbox?.status || 'not_found';
  }

  public async getPreviewUrl(sandboxId: string, port: number): Promise<string> {
    return `https://mock-preview-${sandboxId}.example.com:${port}`;
  }

  public disconnect(): void {
    console.log(chalk.gray('📡 [Mock] Disconnected from mock sandbox manager'));
  }

  public get availableProviders() {
    return ['mock-daytona', 'mock-docker', 'mock-local'] as const;
  }

  public async listSandboxes() {
    return Array.from(this.mockSandboxes.values());
  }

  public async getSandboxLogs(sandboxId: string) {
    return [
      `[Mock] Sandbox ${sandboxId} started`,
      `[Mock] Agent initialized`,
      `[Mock] Ready to receive prompts`,
    ];
  }

  private generateMockResponse(prompt: string, agentType: string): AgentOutput[] {
    const responses: AgentOutput[] = [];
    
    // Simulate tool use
    responses.push({
      type: 'tool_use',
      toolName: 'read',
      toolInput: { filePath: '/mock/file.txt' }
    });

    responses.push({
      type: 'tool_result',
      toolResult: 'Mock file content',
      isError: false
    });

    // Simulate content response
    const mockContent = this.generateMockContent(prompt, agentType);
    for (let i = 0; i < mockContent.length; i += 10) {
      responses.push({
        type: 'content',
        content: mockContent.slice(i, i + 10)
      });
    }

    return responses;
  }

  private generateMockContent(prompt: string, agentType: string): string {
    const responses = {
      build: `I'll help you with that task. Let me analyze the code and make the necessary changes.

Based on your request: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"

I've examined the codebase and here's what I'll do:
1. Update the relevant files
2. Ensure compatibility
3. Test the changes

The changes have been implemented successfully. The code is now updated and should work as expected.`,

      plan: `# Implementation Plan

Based on your request: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"

## Overview
This plan outlines the steps needed to implement your requested changes.

## Steps
1. **Analysis** - Review current code structure
2. **Implementation** - Make necessary code changes
3. **Testing** - Verify changes work correctly
4. **Documentation** - Update relevant docs

## Next Actions
- [ ] Review the plan
- [ ] Approve for implementation
- [ ] Execute the changes

This plan provides a structured approach to implementing your requirements.`,

      sisyphus: `I've reviewed your request and here's my analysis:

"${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"

This is an interesting challenge. Let me break down the approach:

1. **Current State**: Understanding the existing implementation
2. **Proposed Changes**: What needs to be modified
3. **Implementation Strategy**: Step-by-step approach
4. **Potential Issues**: Things to watch out for

The implementation looks straightforward and should integrate well with the existing system.`
    };

    return responses[agentType] || responses.build;
  }

  private renderAgentOutput(output: AgentOutput): void {
    switch (output.type) {
      case 'content':
        process.stdout.write(output.content || '');
        break;
      
      case 'tool_use':
        console.log(chalk.blue(`\n🔧 [Mock] Using tool: ${output.toolName}`));
        if (output.toolInput && Object.keys(output.toolInput).length > 0) {
          console.log(chalk.gray(JSON.stringify(output.toolInput, null, 2)));
        }
        break;
      
      case 'tool_result':
        if (output.isError) {
          console.log(chalk.red('❌ [Mock] Tool error:'), output.toolResult);
        } else {
          console.log(chalk.green('✅ [Mock] Tool result:'), 
            typeof output.toolResult === 'string' 
              ? output.toolResult 
              : JSON.stringify(output.toolResult, null, 2)
          );
        }
        break;
      
      case 'error':
        console.log(chalk.red('\n❌ [Mock] Error:'), output.content);
        break;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
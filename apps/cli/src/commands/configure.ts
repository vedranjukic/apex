import { Command } from 'commander';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { DatabaseManager } from '../database/bun-sqlite.js';
import { configManager } from '../config/index.js';

export function createConfigureCommand(): Command {
  const command = new Command('configure')
    .description('Configure API keys and settings')
    .action(async () => {
      const config = configManager.config;
      const db = new DatabaseManager(config.dbPath);
      
      try {
        console.log();
        console.log(chalk.cyan.bold('  Apex Configuration'));
        console.log(chalk.gray(`  Database: ${config.dbPath}`));
        console.log();

        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        // Anthropic API Key
        const currentAnthropic = config.anthropicApiKey;
        const anthropicKey = await promptInput(
          rl, 
          'Anthropic API Key', 
          maskKey(currentAnthropic)
        );
        if (anthropicKey.trim()) {
          db.setSetting('ANTHROPIC_API_KEY', anthropicKey.trim());
          console.log(chalk.green('✓ Anthropic API key saved'));
        }

        // Daytona API Key
        const currentDaytona = config.daytonaApiKey;
        const daytonaKey = await promptInput(
          rl,
          'Daytona API Key',
          maskKey(currentDaytona)
        );
        if (daytonaKey.trim()) {
          db.setSetting('DAYTONA_API_KEY', daytonaKey.trim());
          console.log(chalk.green('✓ Daytona API key saved'));
        }

        // Daytona API URL
        const currentUrl = config.daytonaApiUrl;
        const daytonaUrl = await promptInput(
          rl,
          'Daytona API URL',
          currentUrl
        );
        if (daytonaUrl.trim()) {
          db.setSetting('DAYTONA_API_URL', daytonaUrl.trim());
          console.log(chalk.green('✓ Daytona API URL saved'));
        }

        // OpenAI API Key (optional)
        const currentOpenAI = config.openaiApiKey;
        const openaiKey = await promptInput(
          rl,
          'OpenAI API Key (optional)',
          maskKey(currentOpenAI)
        );
        if (openaiKey.trim()) {
          db.setSetting('OPENAI_API_KEY', openaiKey.trim());
          console.log(chalk.green('✓ OpenAI API key saved'));
        }

        // Default Provider
        const currentProvider = config.defaultProvider;
        const provider = await promptInput(
          rl,
          'Default Provider (daytona/docker/local/apple-container)',
          currentProvider
        );
        if (provider.trim() && ['daytona', 'docker', 'local', 'apple-container'].includes(provider.trim())) {
          db.setSetting('APEX_DEFAULT_PROVIDER', provider.trim());
          console.log(chalk.green('✓ Default provider saved'));
        }

        // Default Agent Type
        const currentAgentType = config.defaultAgentType;
        const agentType = await promptInput(
          rl,
          'Default Agent Type (build/plan/sisyphus)',
          currentAgentType
        );
        if (agentType.trim() && ['build', 'plan', 'sisyphus'].includes(agentType.trim())) {
          db.setSetting('APEX_DEFAULT_AGENT_TYPE', agentType.trim());
          console.log(chalk.green('✓ Default agent type saved'));
        }

        rl.close();

        console.log();
        console.log(chalk.green(`  Configuration saved to ${config.dbPath}`));
        console.log();
      } catch (error) {
        console.error(chalk.red('Configuration failed:'), (error as Error).message);
        process.exit(1);
      } finally {
        db.close();
      }
    });

  return command;
}

function promptInput(rl: any, label: string, current?: string): Promise<string> {
  return new Promise((resolve) => {
    const prompt = current 
      ? `  ${label} [${current}]: `
      : `  ${label}: `;
    
    rl.question(prompt, (answer: string) => {
      // If empty and we have a current value, keep the current value
      resolve(answer.trim() || current || '');
    });
  });
}

function maskKey(key?: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '…' + key.slice(-4);
}
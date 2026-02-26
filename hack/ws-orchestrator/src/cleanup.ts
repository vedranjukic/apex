/**
 * Cleanup script - delete all Daytona sandboxes
 */

import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import chalk from 'chalk';

async function cleanup() {
  console.log(chalk.yellow('🧹 Cleaning up all Daytona sandboxes...\n'));

  const daytona = new Daytona();
  const sandboxes = await daytona.list();

  console.log(chalk.gray(`Found ${sandboxes.length} sandbox(es)\n`));

  for (const sandbox of sandboxes) {
    try {
      console.log(chalk.white(`Deleting: ${sandbox.id}`));
      await sandbox.delete();
      console.log(chalk.green(`  ✓ Deleted`));
    } catch (err) {
      console.log(chalk.red(`  ✗ Failed: ${err}`));
    }
  }

  console.log(chalk.green('\n✅ Cleanup complete'));
}

cleanup().catch(console.error);

/**
 * Minimal WebSocket Test for Daytona
 * 
 * Uses proper Daytona APIs:
 * - sandbox.fs for file operations
 * - sandbox.process.createSession + executeSessionCommand for background processes
 * - sandbox.getPreviewLink with token for authentication
 */

import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import WebSocket from 'ws';
import chalk from 'chalk';
import https from 'https';
import { File } from 'node:buffer';

const PORT = 8080;

async function main() {
  console.log(chalk.bold.cyan('\n🧪 Daytona WebSocket Test\n'));

  const daytona = new Daytona();

  // Step 1: Create sandbox
  console.log(chalk.yellow('1️⃣  Creating sandbox...'));
  const sandbox = await daytona.create({
    snapshot: 'daytona-claude-l',
    autoStopInterval: 0,
    timeout: 120,
  });
  console.log(chalk.green(`   ✅ Sandbox: ${sandbox.id}`));

  try {
    // Step 2: Write WebSocket server
    console.log(chalk.yellow('\n2️⃣  Writing WebSocket server...'));
    
    const serverCode = `const http = require("http");
const { WebSocketServer } = require("ws");
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
});
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  console.log("connected");
  ws.send("hello");
  ws.on("message", (msg) => ws.send("echo:" + msg));
});
server.listen(${PORT}, "0.0.0.0", () => console.log("listening on ${PORT}"));`;

    // Create directory first and use absolute path
    const workDir = '/home/daytona/wstest';
    await sandbox.fs.createFolder(workDir, '755');
    console.log(chalk.gray(`   📁 Created: ${workDir}`));
    
    // Upload file - path first, then File object
    const serverPath = `${workDir}/server.js`;
    await sandbox.fs.uploadFile(
      serverPath,
      new File([Buffer.from(serverCode)], 'server.js', { type: 'text/plain' }),
    );
    console.log(chalk.green(`   ✅ Uploaded: ${serverPath}`));
    
    // Verify file exists
    const lsResult = await sandbox.process.executeCommand(`ls -la ${workDir}`);
    console.log(chalk.gray(`   📋 Dir listing:\n${lsResult.result}`));
    
    const catResult = await sandbox.process.executeCommand(`head -5 ${serverPath}`);
    console.log(chalk.gray(`   📋 File head: ${catResult.result?.slice(0, 100)}...`));

    // Step 3: Install ws
    console.log(chalk.yellow('\n3️⃣  Installing ws...'));
    
    await sandbox.process.executeCommand('npm init -y', workDir);
    await sandbox.process.executeCommand('npm install ws', workDir);
    console.log(chalk.green('   ✅ ws installed'));

    // Step 4: Start server using session (for background execution)
    console.log(chalk.yellow('\n4️⃣  Starting server via session...'));
    
    const sessionId = `ws-${Date.now()}`;
    await sandbox.process.createSession(sessionId);
    console.log(chalk.gray(`   📋 Session: ${sessionId}`));

    // Execute server in session - pass object with command and async flag
    const execResult = await sandbox.process.executeSessionCommand(sessionId, {
      command: `cd ${workDir} && node server.js`,
      async: true,
    });
    console.log(chalk.green(`   ✅ Server started async (cmdId: ${execResult.cmdId})`));

    // Wait for server to start
    await new Promise((r) => setTimeout(r, 3000));

    // Debug: check session command logs
    const cmdLogs = await sandbox.process.getSessionCommandLogs(sessionId, execResult.cmdId);
    console.log(chalk.gray(`   📋 Session cmd logs: ${cmdLogs || '(empty)'}`));

    // Debug: check running processes
    const psResult = await sandbox.process.executeCommand('pgrep -a node');
    console.log(chalk.gray(`   📋 Processes: ${psResult.result?.trim() || 'none'}`));

    // Debug: check if port is listening
    const ssResult = await sandbox.process.executeCommand('ss -tlnp');
    console.log(chalk.gray(`   📋 Listening ports:\n${ssResult.result?.trim() || 'none'}`));

    // Verify server is running locally
    const checkResult = await sandbox.process.executeCommand(`curl -s http://localhost:${PORT}`);
    console.log(chalk.green(`   ✅ Local curl: ${checkResult.result || '(no response)'}`));

    // Step 5: Get preview URL with token
    console.log(chalk.yellow('\n5️⃣  Getting preview URL with token...'));
    const previewInfo = await sandbox.getPreviewLink(PORT);
    
    let previewUrl: string;
    let previewToken: string | undefined;
    
    if (typeof previewInfo === 'string') {
      previewUrl = previewInfo;
      console.log(chalk.yellow('   ⚠️  Got string URL (no token)'));
    } else {
      previewUrl = (previewInfo as any).url;
      previewToken = (previewInfo as any).token;
      console.log(chalk.green(`   ✅ URL: ${previewUrl}`));
      console.log(chalk.green(`   ✅ Token: ${previewToken?.slice(0, 20)}...`));
    }

    // Step 6: Test HTTP with token
    console.log(chalk.yellow('\n6️⃣  Testing HTTP with token...'));
    const httpResult = await testHttp(previewUrl, previewToken);
    console.log(chalk.green(`   ✅ HTTP: ${httpResult}`));

    // Step 7: Test WebSocket with token
    console.log(chalk.yellow('\n7️⃣  Testing WebSocket with token...'));
    const wsUrl = previewUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    console.log(chalk.gray(`   🔗 WS URL: ${wsUrl}`));
    
    await testWebSocket(wsUrl, previewToken);

    // Cleanup session
    await sandbox.process.deleteSession(sessionId);
    console.log(chalk.gray(`   🗑️  Session deleted`));

  } catch (err) {
    console.error(chalk.red(`\n❌ Error: ${err}`));
  } finally {
    console.log(chalk.yellow('\n🧹 Cleaning up...'));
    await sandbox.delete();
    console.log(chalk.green('   ✅ Sandbox deleted'));
  }
}

async function testHttp(url: string, token?: string): Promise<string> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {
      'X-Daytona-Skip-Preview-Warning': 'true',
    };
    if (token) {
      headers['x-daytona-preview-token'] = token;
    }

    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(`Status: ${res.statusCode}, Body: ${data.slice(0, 100)}`));
    });
    req.on('error', (err) => resolve(`Error: ${err.message}`));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve('Timeout');
    });
  });
}

async function testWebSocket(url: string, token?: string): Promise<void> {
  return new Promise((resolve) => {
    console.log(chalk.gray(`   Connecting to: ${url}`));
    if (token) {
      console.log(chalk.gray(`   With token: ${token.slice(0, 20)}...`));
    }
    
    const headers: Record<string, string> = {
      'X-Daytona-Skip-Preview-Warning': 'true',
    };
    if (token) {
      headers['x-daytona-preview-token'] = token;
    }

    const ws = new WebSocket(url, { headers, handshakeTimeout: 15000 });

    const timeout = setTimeout(() => {
      console.log(chalk.red(`   ❌ Timeout after 15s`));
      ws.close();
      resolve();
    }, 15000);

    ws.on('open', () => {
      console.log(chalk.green(`   ✅ WebSocket connected!`));
      ws.send('Hello from host!');
    });

    ws.on('message', (data) => {
      console.log(chalk.green(`   📥 Received: ${data.toString()}`));
      clearTimeout(timeout);
      ws.close();
      resolve();
    });

    ws.on('error', (err) => {
      console.log(chalk.red(`   ❌ Error: ${err.message}`));
      clearTimeout(timeout);
      resolve();
    });

    ws.on('close', (code, reason) => {
      console.log(chalk.gray(`   🔌 Closed: code=${code}`));
      clearTimeout(timeout);
      resolve();
    });

    ws.on('unexpected-response', (req, res) => {
      console.log(chalk.yellow(`   ⚠️  HTTP ${res.statusCode}`));
      let body = '';
      res.on('data', (chunk: Buffer) => body += chunk.toString());
      res.on('end', () => {
        if (body) console.log(chalk.gray(`   Body: ${body.slice(0, 150)}`));
        if (res.headers.location) {
          console.log(chalk.yellow(`   Redirect: ${res.headers.location.slice(0, 80)}...`));
        }
        clearTimeout(timeout);
        resolve();
      });
    });
  });
}

main().catch(console.error);

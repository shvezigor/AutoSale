import { existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('.', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const options = { cwd, stdio: 'inherit', shell: process.platform === 'win32' };
if (!existsSync(new URL('node_modules/.package-lock.json', import.meta.url))) {
  const result = spawnSync(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], options);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const server = spawn(npm, ['run', 'dev'], options);
server.on('exit', code => process.exit(code ?? 1));

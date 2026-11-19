// Test-only child: no reader dependency, OS command, audio or GUI.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const [mode, ready] = process.argv.slice(2);
if (mode === 'success') {
  console.log(JSON.stringify({origin: 'inert_worker_test', text: 'Fictional phrase.', pid: process.pid}));
} else if (mode === 'failure') {
  console.log(JSON.stringify({error: 'Inert test refusal'})); process.exitCode = 1;
} else if (mode === 'oversized') {
  process.stdout.write(Buffer.alloc(70000, 65)); setInterval(() => {}, 1000);
} else if (mode === 'leaf') {
  process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
} else {
  process.on('SIGTERM', () => {});
  let leaf;
  if (mode === 'tree') {
    leaf = spawn(process.execPath, [fileURLToPath(import.meta.url), 'leaf'],
      {stdio: 'ignore', detached: false});
    await new Promise((resolve, reject) => {leaf.once('spawn', resolve); leaf.once('error', reject);});
  }
  if (ready) await writeFile(ready, JSON.stringify({pid: process.pid, leaf: leaf?.pid}), {flag: 'wx'});
  setInterval(() => {}, 1000);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { reader } from '../src/reader.mjs';
import { lastSpokenPhrase } from '@guidepup/guidepup/lib/macOS/VoiceOver/lastSpokenPhrase.js';
import { performCommand } from '@guidepup/guidepup/lib/macOS/VoiceOver/performCommand.js';
import { retry } from '@guidepup/guidepup/lib/retry.js';
import { readerOperation } from '../src/guidepup-adapter.mjs';

test('pinned Guidepup internals resolve without starting reader or changing preferences', () => {
  assert.equal(typeof lastSpokenPhrase, 'function'); assert.equal(typeof performCommand, 'function');
});
test('unlisted reader actions rejected before creating a subprocess', async () => {
  await assert.rejects(reader('run arbitrary script'), /Unsupported/);
  await assert.rejects(reader('activate', { setup: true }), /Setup may only/);
});
test('adapter executes one dependency attempt, preserving actual returned text and audio uncertainty', async () => {
  let attempts = 0;
  const result = await readerOperation('phrase', {
    lastSpokenPhrase: options => retry(async () => { attempts++; return 'Actual test phrase. Button.'; }, options)
  });
  assert.equal(attempts, 1); assert.equal(result.text, 'Actual test phrase. Button.');
  assert.equal(result.spokenAudioVerified, false);
});
test('dependency refusal is an error, never an invented phrase', async () => {
  await assert.rejects(readerOperation('phrase', {
    lastSpokenPhrase: options => retry(async () => { throw new Error('Permission denied'); }, options)
  }), /Permission denied/);
});
test('navigation uses native reader commands and keeps text distinct from audio', async () => {
  for (const [action, command] of [['next', 'move right'], ['previous', 'move left']]) {
    const calls = [];
    const result = await readerOperation(action, {
      performCommand: async (...args) => calls.push(args),
      move: async () => { throw Error('Direct cursor movement bypassed focus-following in the live dismissal probe'); },
      lastSpokenPhrase: async () => 'Next control. Button.'
    });
    assert.equal(calls.length, 1); assert.equal(calls[0][0], command);
    assert.equal(calls[0][1].retries, 1);
    assert.equal(result.text, 'Next control. Button.'); assert.equal(result.spokenAudioVerified, false);
  }
});
test('navigation refusal has no direct-cursor fallback', async () => {
  await assert.rejects(readerOperation('next', {
    performCommand: async () => { throw Error('Permission denied'); },
    move: async () => { throw Error('No alternate navigation after refusal'); }
  }), /Permission denied/);
});
test('activation uses the reader command and preserves its full reported context', async () => {
  const calls = [];
  const result = await readerOperation('activate', {
    performCommand: async (...args) => calls.push(args),
    performAction: async () => { throw Error('Direct cursor action lost dialog entry context in live capture'); },
    lastSpokenPhrase: async () => 'Photo web dialog with 11 items Close button'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'perform action for item');
  assert.equal(calls[0][1].retries, 1);
  assert.equal(result.text, 'Photo web dialog with 11 items Close button');
  assert.equal(result.spokenAudioVerified, false);
});
test('reader activation refusal is not retried through a different action path', async () => {
  await assert.rejects(readerOperation('activate', {
    performCommand: async () => { throw Error('Permission denied'); },
    performAction: async () => { throw Error('Unapproved fallback'); },
    lastSpokenPhrase: async () => { throw Error('No invented success after refusal'); }
  }), /Permission denied/);
});
test('actual MCP negotiation/list/rejected tool call do not start recording', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'reader-mcp-')));
  const client = new Client({ name: 'reader-capture-test', version: '1.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env: { PATH: process.env.PATH, READER_CAPTURE_OUTPUT: root, READER_CAPTURE_HELPER: '/nonexistent-reader-helper' }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(x => x.name), ['voiceover_setup', 'record_system_audio', 'voiceover_action']);
    assert.deepEqual(await readdir(root), []);
    const invalid = await client.callTool({ name: 'record_system_audio', arguments: { seconds: 31 } });
    assert.equal(invalid.isError, true); assert.deepEqual(await readdir(root), []);
    const extra = await client.callTool({ name: 'record_system_audio', arguments: { seconds: 1, capture: 'mic' } });
    assert.equal(extra.isError, true); assert.deepEqual(await readdir(root), []);
    const missing = await client.callTool({ name: 'record_system_audio', arguments: { seconds: 1 } });
    assert.equal(missing.isError, true);
    assert.equal(JSON.parse(missing.content[0].text).microphone, 'unused');
    assert.equal((await readdir(root)).length, 1);
  } finally { await client.close(); }
});

test('stdio client receives first-frame progress and system-only bounded arguments reach the helper', async () => {
  const { writeFile } = await import('node:fs/promises');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'reader-progress-')));
  const helper = join(root, 'synthetic-helper');
  await writeFile(helper, '#!' + process.execPath + '\n' +
    "const args = process.argv.slice(2);\n" +
    "if (args.join(' ') !== 'capture --mode=system --sample-rate=16000 --seconds=1 --owner-pid='+process.ppid) process.exit(1);\n" +
    "process.on('SIGTERM', () => process.exit(0));\n" +
    "setInterval(() => process.stdout.write(Buffer.alloc(320, 1)), 20);\n", { mode: 0o700 });
  const client = new Client({ name: 'progress-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env: { PATH: process.env.PATH, READER_CAPTURE_OUTPUT: root, READER_CAPTURE_HELPER: helper }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    const observed = [];
    const result = await client.callTool({ name: 'record_system_audio', arguments: { seconds: 1 } },
      undefined, { onprogress: p => observed.push(p.message) });
    assert.equal(result.isError, false);
    assert.deepEqual(observed, ['First PCM frame received']);
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.firstFrameUtc && data.firstFrameUtc < data.lastFrameUtc);
    assert.equal(data.spokenWordsVerified, false);
  } finally { await client.close(); }
});

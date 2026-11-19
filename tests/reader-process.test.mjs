import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { getEventListeners } from 'node:events';
import { reader } from '../src/reader.mjs';
import { runReaderWorker, createReaderScope, installReaderShutdown } from '../src/reader-process.mjs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const fixture = fileURLToPath(new URL('./fixtures/inert-reader-worker.mjs', import.meta.url));
const readyPath = async () => join(await mkdtemp(join(tmpdir(), 'reader-worker-test-')), 'ready.json');
async function ready(path) {
  for (let i = 0; i < 100; i++) {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await delay(20); }
  }
  throw new Error('Owned inert fixture did not become ready');
}
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
async function gone(pid) {
  for (let i = 0; i < 100; i++) { if (!alive(pid)) return; await delay(20); }
  assert.fail('Owned inert process remained alive after cleanup');
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Automatic cleanup did not finish before the test bound')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
function cleanOwned(pid) {
  if (pid) try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

test('pre-aborted worker and actual reader wrapper reject before worker startup', async () => {
  const abort = new AbortController(); abort.abort(); const path = await readyPath();
  await assert.rejects(runReaderWorker(fixture, ['hang', path], {signal: abort.signal, timeoutMs: 5000}),
    {name: 'AbortError', message: 'Reader operation cancelled before start.'});
  await assert.rejects(reader('phrase', {signal: abort.signal}), {name: 'AbortError'});
  await assert.rejects(access(path), {code: 'ENOENT'});
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('cancellation kills actual owned worker group, awaits child close and removes listeners', async () => {
  const abort = new AbortController(), path = await readyPath(); let owned;
  const operation = runReaderWorker(fixture, ['tree', path], {signal: abort.signal, timeoutMs: 5000});
  const rejected = assert.rejects(operation, {name: 'AbortError', message: 'Reader operation cancelled; worker closed.'});
  try {
    owned = await ready(path); assert.equal(alive(owned.pid), true); assert.equal(alive(owned.leaf), true);
    abort.abort(); abort.abort(); await rejected;
    assert.equal(alive(owned.pid), false, 'result must wait until direct child is closed/reaped');
    await gone(owned.leaf);
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  } finally { abort.abort(); cleanOwned(owned?.pid); await operation.catch(() => {}); }
});

test('normal result waits for actual child exit; later cancellation adds no listeners or new outcome', async () => {
  const abort = new AbortController();
  const result = await runReaderWorker(fixture, ['success'], {signal: abort.signal, timeoutMs: 5000});
  assert.equal(result.text, 'Fictional phrase.'); assert.equal(alive(result.pid), false);
  abort.abort(); assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('timeout and output overflow close actual inert children without a fabricated result', async () => {
  const path = await readyPath(); let owned;
  const operation = runReaderWorker(fixture, ['hang', path], {timeoutMs: 500});
  const rejected = assert.rejects(operation, /timed out; worker closed/);
  try { owned = await ready(path); await rejected; assert.equal(alive(owned.pid), false); }
  finally { cleanOwned(owned?.pid); await operation.catch(() => {}); }
  await assert.rejects(runReaderWorker(fixture, ['oversized'], {timeoutMs: 5000}), /output exceeded its limit/);
});

test('reader refusal remains failure and cleans abort listeners', async () => {
  const abort = new AbortController();
  await assert.rejects(runReaderWorker(fixture, ['failure'], {signal: abort.signal, timeoutMs: 5000}), /Inert test refusal/);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('closing scope before its deferred operation starts prevents spawn and rejects later operations', async () => {
  const path = await readyPath();
  const scope = createReaderScope((action, options) => runReaderWorker(fixture, ['hang', path], {signal: options.signal, timeoutMs: 5000}));
  const operation = scope.run('phrase'); const rejected = assert.rejects(operation, {name: 'AbortError'});
  const close = scope.close(); assert.equal(scope.close(), close); await close; await rejected;
  await assert.rejects(access(path), {code: 'ENOENT'});
  await assert.rejects(scope.run('phrase'), /server is closing/);
});

for (const termination of ['end', 'SIGINT', 'SIGTERM', 'transport-close']) {
  test(`graceful ${termination} drains actual reader worker before idempotent transport close`, async () => {
    const path = await readyPath(), stdin = new EventEmitter(), signals = new EventEmitter();
    const scope = createReaderScope((action, options) => runReaderWorker(fixture, ['tree', path], {signal: options.signal, timeoutMs: 5000}));
    let owned, closes = 0, previous = 0, markTransportClosed;
    const transportClosed = new Promise(resolve => {markTransportClosed = resolve;});
    const server = {onclose: () => {previous++;}, close: async () => {
      closes++; assert.equal(alive(owned.pid), false, 'drain precedes transport close'); server.onclose?.(); markTransportClosed();
    }};
    const shutdown = installReaderShutdown({server, readers: scope, stdin, signals,
      onError: () => assert.fail('Unexpected shutdown failure')});
    const operation = scope.run('phrase'), rejected = assert.rejects(operation, {name: 'AbortError'});
    try {
      owned = await ready(path);
      if (termination === 'transport-close') server.onclose();
      else if (termination === 'end') stdin.emit('end');
      else signals.emit(termination);
      // Trigger must do the work itself. A manual close cannot manufacture a pass.
      await bounded(Promise.all([rejected, transportClosed]));
      const close = shutdown.close(); assert.equal(shutdown.close(), close);
      await close; await rejected; await gone(owned.leaf);
      assert.equal(closes, 1); assert.ok(previous >= 1);
      assert.equal(stdin.listenerCount('end'), 0);
      assert.equal(signals.listenerCount('SIGINT'), 0); assert.equal(signals.listenerCount('SIGTERM'), 0);
    } finally { cleanOwned(owned?.pid); await shutdown.close(); await operation.catch(() => {}); }
  });
}

test('installed MCP cancellation reaches scope signal and closes real inert worker', async () => {
  const path = await readyPath(); let owned, handlerOperation, markHandlerStarted;
  const handlerStarted = new Promise(resolve => {markHandlerStarted = resolve;});
  const readers = createReaderScope((action, options) => runReaderWorker(fixture, ['hang', path], {signal: options.signal, timeoutMs: 5000}));
  const server = new Server({name: 'inert-reader-cancellation-test', version: '1'}, {capabilities: {tools: {}}});
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    handlerOperation = readers.run('phrase', {signal: extra.signal}); markHandlerStarted();
    return {content: [{type: 'text', text: JSON.stringify(await handlerOperation)}]};
  });
  const shutdown = installReaderShutdown({server, readers, stdin: new EventEmitter(), signals: new EventEmitter()});
  const client = new Client({name: 'inert-reader-cancellation-test', version: '1'});
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(right), client.connect(left)]);
    const abort = new AbortController();
    const operation = client.callTool({name: 'inert-test-only', arguments: {}}, undefined, {signal: abort.signal});
    const rejected = assert.rejects(operation);
    owned = await ready(path); await handlerStarted;
    const handlerCancelled = assert.rejects(handlerOperation, {name: 'AbortError'});
    abort.abort(); await rejected;
    // The SDK rejects its client immediately; independently await actual handler
    // cleanup before invoking any manual shutdown that could mask lost signal flow.
    await bounded(handlerCancelled); assert.equal(alive(owned.pid), false);
  } finally { cleanOwned(owned?.pid); await shutdown.close(); await client.close(); }
});

test('production dispatch keeps fixed reader path, signal propagation, and unchanged timeout bounds', async () => {
  const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const wrapper = await readFile(new URL('../src/reader.mjs', import.meta.url), 'utf8');
  assert.ok(server.includes('signal: extra.signal'));
  assert.ok(server.includes('await readers.run('));
  assert.ok(wrapper.includes("new URL('./reader-worker.mjs', import.meta.url)"));
  assert.ok(wrapper.includes('timeoutMs: setup ? 48000 : 6000'));
  assert.ok(!server.includes('workerPath: args'));
});

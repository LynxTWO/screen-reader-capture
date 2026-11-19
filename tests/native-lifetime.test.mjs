import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, fork, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, realpath } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const source = file => fileURLToPath(new URL(file, import.meta.url));
test('native capture lifetime with an inert audio controller', { skip: process.platform !== 'darwin' }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'reader-native-')));
  const helper = join(root, 'inert-helper');
  execFileSync('swiftc', [source('../native/main.swift'), source('fixtures/InertController.swift'), '-o', helper]);
  const args = ['capture', '--mode=system', '--sample-rate=16000', '--seconds=1', '--owner-pid=' + process.pid];

  await t.test('refuses missing bounds, wrong owner, unsupported duration and microphone input before capture', () => {
    for (const invalid of [args.slice(0, 3), [...args.slice(0, 4), '--owner-pid=1'],
      args.map(x => x === '--seconds=1' ? '--seconds=31' : x),
      args.map(x => x === '--mode=system' ? '--mode=mic' : x)]) {
      const r = spawnSync(helper, invalid, { timeout: 3500 });
      assert.equal(r.status, 1); assert.equal(r.stdout.length, 0);
    }
  });
  for (const cooperative of [true, false]) {
    await t.test(cooperative ? 'native duration requests stop' : 'native hard deadline survives ignored TERM', async () => {
      const child = spawn(helper, args, { env: cooperative ? { TEST_COOPERATIVE: '1' } : {}, stdio: ['ignore', 'pipe', 'pipe'] });
      const closed = once(child, 'close');
      const rescue = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        const [frame] = await once(child.stdout, 'data');
        assert.equal(frame.length, 2);
        assert.deepEqual(await closed, [null, cooperative ? 'SIGTERM' : 'SIGALRM']);
      } finally { clearTimeout(rescue); }
    });
  }
  await t.test('native helper stops after SIGKILL of the production capture wrapper, even with no more frames', async () => {
    const wrapper = fork(source('fixtures/inert-capture-wrapper.mjs'), [root, helper], { silent: true });
    const closed = once(wrapper, 'exit');
    let childPid;
    const alive = () => {
      try { process.kill(childPid, 0); return true; }
      catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    };
    try {
      const [message] = await once(wrapper, 'message', { signal: AbortSignal.timeout(5000) });
      assert.equal(message, 'first-frame');
      const children = execFileSync('pgrep', ['-P', String(wrapper.pid)], { encoding: 'utf8' }).trim();
      assert.match(children, /^\d+$/); childPid = Number(children);
      wrapper.kill('SIGKILL');
      assert.deepEqual(await closed, [null, 'SIGKILL']);
      const until = performance.now() + 2500;
      while (alive() && performance.now() < until) await delay(25);
      assert.equal(alive(), false, 'orphan must exit well before the requested 30 seconds');
    } finally {
      wrapper.kill('SIGKILL');
      if (childPid && alive()) process.kill(childPid, 'SIGKILL');
    }
  });
});

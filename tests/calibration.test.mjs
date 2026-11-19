import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate } from '../scripts/calibrate.mjs';

const phrase = { origin: 'voiceover_last_phrase_api', text: 'Capture check. Ten seconds. Thirty seconds. button' };
const sample = { firstFrameUtc: '2000-01-01T00:00:00.000Z', lastFrameUtc: '2100-01-01T00:00:00.000Z',
  status: 'recorded_audio_unverified' };

test('wrong target stops the calibration before recording', async () => {
  const calls = [];
  await assert.rejects(calibrate(async name => { calls.push(name); return { ...phrase, text: 'different' }; }, {}), /cursor/);
  assert.deepEqual(calls, ['voiceover_setup', 'voiceover_action']);
});
test('a completed capture without readiness cannot trigger a second reader action', async () => {
  const calls = [], report = {};
  await assert.rejects(calibrate(async name => { calls.push(name); return name === 'record_system_audio' ? sample : phrase; }, report, async () => {}), /first-frame/);
  assert.deepEqual(calls, ['voiceover_setup', 'voiceover_action', 'record_system_audio']);
  assert.equal(report.recording, sample);
});
test('calibration requires a bracketed action, matching reader text and a silent control', async () => {
  for (const outcome of ['late', 'wrong-phrase', 'noisy-control', 'ready']) {
    const report = {}, pending = Promise.withResolvers();
    let actions = 0;
    const order = [];
    const run = calibrate(async (name, args, progress) => {
      if (name === 'voiceover_setup') return phrase;
      if (name === 'voiceover_action') {
        if (++actions === 2) {
          pending.resolve(outcome === 'late' ? { ...sample, lastFrameUtc: sample.firstFrameUtc } : sample);
          if (outcome === 'wrong-phrase') return { ...phrase, text: 'unrelated' };
        }
        return phrase;
      }
      order.push(args.seconds);
      if (args.seconds === 4) return { status: outcome === 'noisy-control' ? 'recorded_audio_unverified' : 'silent_audio' };
      progress({ message: 'First PCM frame received' });
      return pending.promise;
    }, report, async ms => { order.push(ms); });
    if (outcome === 'ready') {
      await run;
      assert.equal(report.status, 'ready_for_listening_review');
    } else {
      await assert.rejects(run, /are required|digitally silent/);
      assert.ok(report.recording);
    }
    assert.deepEqual(order, ['late', 'wrong-phrase'].includes(outcome) ? [15000, 10] : [15000, 10, 15000, 4]);
  }
});

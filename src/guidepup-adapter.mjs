import { lastSpokenPhrase } from '@guidepup/guidepup/lib/macOS/VoiceOver/lastSpokenPhrase.js';
import { performCommand } from '@guidepup/guidepup/lib/macOS/VoiceOver/performCommand.js';

const commands = new Map([
  ['describe', 'describe item in voiceover cursor'],
  ['activate', 'perform action for item'],
  ['next', 'move right'], ['previous', 'move left'],
  ['escape', 'escape'],
  ['interact', 'start interacting with item'], ['stop_interacting', 'stop interacting with item'],
  ['sync_focus', 'move voiceover cursor to keyboard focus']
]);
export async function readerOperation(action, api = { lastSpokenPhrase, performCommand }, timeout = 1200) {
  if (action !== 'phrase' && !commands.has(action)) throw new Error('Unsupported reader action');
  // Guidepup calls the count "retries", but it is total attempts: zero executes nothing.
  const options = { timeout, retries: 1 };
  if (action !== 'phrase') {
    await api.performCommand(commands.get(action), options);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const text = await api.lastSpokenPhrase(options);
  return { origin: 'voiceover_last_phrase_api', text,
    utc: new Date().toISOString(), spokenAudioVerified: false,
    limitation: 'Last-phrase text can be stale or incomplete; compare action timing and actual recording.' };
}

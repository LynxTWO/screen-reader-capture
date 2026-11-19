import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capture } from './capture.mjs';
import { reader, readerActions } from './reader.mjs';
import { createReaderScope, installReaderShutdown } from './reader-process.mjs';

const helper = process.env.READER_CAPTURE_HELPER;
const root = process.env.READER_CAPTURE_OUTPUT;
if (!helper || !root) throw new Error('Configure READER_CAPTURE_HELPER and READER_CAPTURE_OUTPUT. No capture starts on server launch.');
await mkdir(root, { recursive: true, mode: 0o700 });
if (await realpath(root) !== resolve(root)) throw new Error('Output root must not traverse a symlink');
let busy = false;
let readerBusy = false;
const server = new Server({ name: 'reader-capture-local', version: '0.1.0' }, { capabilities: { tools: {} } });
const readers = createReaderScope(reader);
installReaderShutdown({ server, readers });
const tools = [
  { name: 'voiceover_setup', description: 'Request access to genuine VoiceOver last-phrase text with a separate 45-second permission window. No recording, navigation, preference changes or reader startup. Owner must approve any normal macOS prompt.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'record_system_audio', description: 'Record only system audio for 1 to 30 seconds, stop automatically, and return local evidence metadata. Can include other playing applications. Never proves spoken words by itself.',
    inputSchema: { type: 'object', properties: { seconds: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['seconds'], additionalProperties: false } },
  { name: 'voiceover_action', description: 'Read genuine VoiceOver last-phrase text or perform one allowlisted reader action. Requires an already-running attended VoiceOver session and owner-granted scripting access. Does not change reader preferences. Text is not recorded audio.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: readerActions } }, required: ['action'], additionalProperties: false } }
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  try {
    const { name, arguments: args = {} } = request.params;
    let result;
    if (name === 'record_system_audio') {
      if (busy) throw new Error('A recording is already active');
      if (Object.keys(args).some(k => k !== 'seconds')) throw new Error('Unexpected recording argument');
      busy = true;
      const progressToken = request.params._meta?.progressToken;
      const onFirstFrame = () => {
        if (progressToken === undefined) return;
        // A client disconnect must never prevent the recorder from stopping.
        void extra.sendNotification({ method: 'notifications/progress',
          params: { progressToken, progress: 1, message: 'First PCM frame received' } }).catch(() => {});
      };
      try { result = await capture({ seconds: args.seconds, root, helper, onFirstFrame, signal: extra.signal }); }
      finally { busy = false; }
    } else if (name === 'voiceover_action' || name === 'voiceover_setup') {
      if (name === 'voiceover_setup' && Object.keys(args).length) throw new Error('Setup accepts no arguments');
      if (Object.keys(args).some(k => k !== 'action')) throw new Error('Unexpected reader argument');
      if (readerBusy) throw new Error('Another reader action is active');
      readerBusy = true;
      try { result = await readers.run(name === 'voiceover_setup' ? 'phrase' : args.action,
        { setup: name === 'voiceover_setup', signal: extra.signal }); }
      finally { readerBusy = false; }
    } else throw new Error('Unknown tool');
    return { isError: result.status === 'failed_or_partial' || result.status === 'no_audio_frames',
      content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
await server.connect(new StdioServerTransport());

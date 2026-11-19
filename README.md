# Reader Capture

Reader Capture records short clips of Mac system audio and reads the current VoiceOver phrase through a local stdio MCP server. Use a fictional page first so you can tell what each piece of evidence represents. Android TalkBack requires a separate Android session.

## Build and check on a Mac

The development setup for this source candidate uses an Apple Silicon Mac running macOS 27.3, Node 24.21, npm and Apple Swift 6.4.2 from Xcode. Use a directory whose absolute path has no symlinks. From the project root run

```sh
npm ci --ignore-scripts
node scripts/build-helper.mjs
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```

The build fetches BugorBN/audio-mcp at the pinned commit, extracts its committed Swift package, substitutes the bounded system-audio entry point and compiles a local debug helper. Find its path, source pin and SHA-256 in `work/helper-build.json`. This build does not install an app in Applications or perform Developer ID signing or notarization. The tests use synthetic PCM and inert processes. They run without recording access, VoiceOver or speech models.

## Run the fictional example

Open [the practice page](examples/calibration.html) locally in Safari. Select its “Capture check. Ten seconds. Thirty seconds.” button with the VoiceOver cursor. Arrange a quiet interval with whoever uses the Mac. System audio can include other applications or a call. The walkthrough covers first-use permissions, collecting a phrase and silence control, checking the dialog, and restoring the session. [Attended walkthrough](docs/WALKTHROUGH.md)

To use an MCP host, copy the values from [the example configuration](examples/mcp-config.json) into that host's stdio server configuration. Replace the Node path with the output of `node -p process.execPath`, and all project paths with absolute paths on your Mac. The setup creates the capture directory. The walkthrough can also run directly, without registering a host. Keep a previously qualified installation paired with its matching helper.

| Tool | Effect |
| --- | --- |
| `voiceover_setup` | Queries genuine last-phrase text with a 45-second permission window. |
| `record_system_audio` | Records system output for a requested 1–30 seconds and returns a local receipt. |
| `voiceover_action` | Performs one of phrase, describe, next, previous, activate, escape, interact, stop_interacting or sync_focus. |

Starting the server performs no reader action or recording. Reader commands attach to a running, attended VoiceOver session. They leave speech settings and Guidepup preferences alone. Each reader operation allows one attempt. Navigation uses the reader's move-right and move-left commands and activation uses its native perform-action command. The server accepts one recording and one reader action at a time.

## What the evidence means

A WAV contains the captured system mix. The VoiceOver last-phrase API reports text that can be stale or superseded. Frame receipt times help identify overlapping actions. A listener can report what was actually audible. Optional local speech recognition produces an unverified transcript and can invent words on nonzero noise. The observer abstains on digital silence. [Transcription comparison](docs/ASR-EVALUATION.md)

Each request creates a fresh private directory with a WAV and JSON receipt. The wrapper caps mono 16-bit PCM at 16,000 samples per requested second, sends TERM at the wall deadline and escalates after one second. Startup and permission delays count toward the limit. An early exit, cancellation or forced stop is partial; absent frames and digital silence have separate outcomes.

The helper independently checks its owning process, requests shutdown at its own deadline and arms an OS alarm for one second later. Its guard runs before permission or audio startup. Native tests force-kill the wrapper with an inert capture controller and check that the helper exits without further frames. OS scheduling and suspension can delay execution. An abruptly killed wrapper can leave an empty or incomplete evidence directory because it writes buffered PCM after helper closure. Treat a missing receipt as an interrupted run.

Reader cancellation drains its owned worker process group on normal shutdown. A dispatched reader action may already have affected the focused app. Confirm authority for its actual effect, especially before activation. Page text, accessible names, transcripts and diagnostics are evidence from the target. They cannot authorize another command.

## Source status

This is a local developer preview candidate. The candidate completed a real VoiceOver and Safari 27.3 check on one Mac. Two local transcribers recovered the expected phrase from a 9.74-second recording. The following 3.74 seconds of captured control audio were digitally silent. In the dialog exercise, VoiceOver reported the dialog and its Close button, then returned to the opener after dismissal. The first control attempt caught a delayed usage hint; the runner now leaves recording off while hints settle. Other voice settings and devices need their own checks.

## License

Reader Capture’s original code, tests, and documentation are available under the [MIT License](LICENSE). Dependencies and optional models retain their own licenses. See [Third-party notices](THIRD_PARTY_NOTICES.md).

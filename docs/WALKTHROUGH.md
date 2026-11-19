# An attended web-reader check

## Set up and restore access

Use a Mac, host and fictional page you control. Start with an agreed quiet interval. Record which reader and settings were already enabled. Only the owner grants system-audio recording access to the exact app macOS identifies, allows the host to automate VoiceOver, and enables AppleScript control under VoiceOver Utility → General. A refused prompt or missing reader ends that attempt. Setup can be run without accepting a grant. Leave existing permissions, voice settings and other applications alone. [Apple recording controls](https://support.apple.com/guide/mac-help/mchld6aa7d23/mac) · [Apple Automation controls](https://support.apple.com/guide/mac-help/mchl07817563/mac) · [VoiceOver scripting](https://support.apple.com/guide/voiceover/cpvougen/mac)

## Phrase, silence and a dialog in Safari

1. Build using the README. Open the supplied `examples/calibration.html` file in Safari and select the fictional button with VoiceOver. With the Mac quiet, run `node scripts/calibrate.mjs --live`. The runner describes the current item and checks its phrase before it records.
2. The runner waits 15 seconds with recording off to let the preflight description and usage hints finish. It starts a ten-second system recording, waits for the first PCM frame to arrive through the local MCP transport, then describes the item again. It stores the start and finish of that call and compares them with first and last frame receipt times. After another 15 seconds with recording off, it records a four-second control with no reader action. The sample receipt times bracket host delivery and include buffering. To identify speech, listen to the WAV and compare what you hear to the reader text. Speech clipped at either end or mixed with unrelated sound is inconclusive.
3. The console prints the private calibration receipt path even after a failed preflight. It includes source hashes for the runner, server, helper and supplied HTML. Confirm you opened that file and record the actual macOS/Safari version, voice, input method and any relevant settings. The runner cannot authenticate the browser page from its spoken label. The WAV and capture result paths are in the receipt. A late action, wrong target or noisy control leaves the calibration inconclusive. If a host serializes independent calls, use the direct runner above.
4. Separately, for this inert dialog only, focus the opener and use VoiceOver activation. Record the actual dialog name, role and entry focus. Navigate to Close, activate it, and record whether the reader returns to the opener. A successful keyboard or DOM check alone establishes neither reader focus nor speech. Mark each entry, close and return as passed, failed, inconclusive or unexecuted and label its evidence (heard, reader text or observed focus).
5. Stop the client, close only the practice tab and restore the observed reader baseline. Keep a reader on if it was already on. If retiring the tool, disable its entry in the host and use System Settings → Privacy & Security → Screen & System Audio Recording and Automation to revoke grants introduced for it. Restore VoiceOver Utility's AppleScript setting only if it was changed solely for this tool. Leave unrelated grants intact. Recordings, receipts and any transcripts remain under local owner control. Inspect and remove or share them deliberately. Cleanup does not authorize further execution.

## Optional local transcription

Capture, native shutdown tests and the dialog exercise do not require a model. The tested observer environment used Python 3.12.14. Create a virtual environment under the ignored work directory and install the pinned dependencies only if you need transcription.

```sh
python3.12 -m venv work/asr-env
work/asr-env/bin/python -m pip install --only-binary=:all: -r requirements-transcription.txt
```

For the default, obtain the five filenames listed in `examples/whisper-large-v3.sha256` from the [pinned model revision](https://huggingface.co/Systran/faster-whisper-large-v3/tree/edaa852ec7e145841d8ffdb056a99866b5f0a478) into `work/models/large-v3/`. The weights alone are about 3.1 GB. Verify all files before inference from the project root.

```sh
(cd work/models/large-v3 && shasum -a 256 -c ../../../examples/whisper-large-v3.sha256)
work/asr-env/bin/python scripts/transcribe-wav.py /absolute/path/to/audio.wav
```

For the optional FP32 cross-check, use the filenames in `examples/parakeet-v3-fp32.sha256` from the [pinned Parakeet revision](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/tree/8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce). Verify them the same way from `work/models/parakeet-v3-fp32` and pass `--backend parakeet-fp32 --model work/models/parakeet-v3-fp32`. Inference uses local files. Retain unexpected words and ambiguity beside the recording.

## Using the same exercise with Android TalkBack

The Mac recorder and its VoiceOver commands do not operate TalkBack. For an attended comparison, open the same fictional HTML on the Android test device in Chrome using an already approved local transfer or fixture origin. Confirm the page and establish reader mode on the static heading before touching the button. Use the device's configured TalkBack navigation and activation to exercise the opener, dialog entry, Close and focus return. Record the Android, Chrome and TalkBack versions and the actual readout for each checkpoint. Distinguish a human readout from a diagnostic request to speak. Restore this device's own baseline. No ADB access or automated Android control is required by this example. [Google TalkBack guide](https://support.google.com/accessibility/android/answer/6283677?hl=en)

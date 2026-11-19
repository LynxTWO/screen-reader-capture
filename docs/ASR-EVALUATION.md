# VoiceOver transcription evaluation

Owner authorization: Daniel Boyd, October 23, 2026, requested larger Whisper and Parakeet on identical recordings and adoption of the better local backend for accessibility checks.

## Method

Compare Whisper Large V3 through faster-whisper 1.2.1 with Parakeet TDT 0.6B V3 through onnx-asr 0.12.0. Both use local CPU INT8 inference with four threads, with no enhancement, vocabulary hints, expected-text prompt or model tuning. Downloaded weights have pinned source revisions and verified upstream LFS checksums. Network connections are denied inside the benchmark process. Raw recordings remain local and ignored.

The fixture has twelve inert controls covering photo actions, durations, selected and disabled states, collapsed and expanded disclosures, checked and unchecked boxes, Close, a message-not-sent negation, retry and pause. The first six cases are the prespecified development split; the latter six are the held-out split. These are small fixed sets, not a statistical accuracy certification. Both recognizers receive the same WAV bytes, with hashes frozen before inference.

References come from the actual VoiceOver last-phrase API. Scores therefore measure agreement with reader-generated text, not independently heard-audio word error rate. Pronunciation, pauses, voice quality and delivery require their own evidence. Word normalization covers case/punctuation, ten/10, thirty/30, voiceover/voice over and checkbox/check box. It does not erase state or negation errors.

Inspect critical fact omissions/inversions separately from word edits: selected state, dimmed/disabled, expanded/collapsed, checked/unchecked, durations, roles and message-not-sent. Record raw recognition on two actual digitally silent controls and one explicitly generated non-speech tone. The production observer abstains before inference on digital silence; raw benchmark results intentionally bypass that guard to expose model behavior. Nonzero noise remains a separate risk.

## Capture repairs and limits

The initial preflight read the last phrase after a delayed hint, then refused the wrong target before recording. The repaired preflight deliberately described the target. Its twelve ten-second describe-item clips still contained fragments of instructional hints before the target announcement. Both raw recognizer result sets are retained as a stress comparison, not clean full-transcript ground truth.

A second corpus uses eight-second recordings of ordinary next-item navigation, beginning one second before the action. Only instructional hints were temporarily disabled. The voice remained Samantha, English US, rate/pitch/volume sliders 0.5, with High speech verbosity. Other speech settings were preserved.

The fixture exposes a checkbox's separate visible label as another reader stop. A target-name guard rejected that label during second-corpus collection. The seven valid clips were retained, the rejected eighth clip was preserved separately, and collection resumed from the verified label predecessor. This is a fixture navigation correction, not a recognizer failure or an application defect.

Manual metric review also caught an overly broad delivery-status classifier: “Sent photo” was being treated as a message-delivered assertion. It remains a word error; the status comparison now requires “message sent” or “message not sent,” with a counterexample test. First raw results remain intact; final reporting recomputes the corrected metric. No recognizer outputs or settings were modified.

## Evidence

Private run root: `work/asr-benchmark-20261023/`. It retains protocols, capture scripts and receipts, platform settings, model provenance, frozen manifests, raw outputs, logs, cleanup and final source-bound results. This experiment does not close application or device acceptance or qualify other voices, rates, languages, browsers or mobile readers.

## Results and adopted default

The twelve isolated navigation clips contain 48 normalized reader-reference words. These are exact matches after the declared normalization, not a claim of general accuracy:

| Local runtime | Exact normalized clips | Missing critical state/role facts | Median inference per clip |
|---|---:|---:|---:|
| Whisper Large V3, CPU INT8 | 12/12 | 0 | 6.67 seconds |
| Parakeet V3, CPU INT8 | 8/12 | 2 | 0.164 seconds |
| Parakeet V3, CPU FP32 | 11/12 | 0 | 0.208 seconds |

Whisper matched all six development and all six held-out isolated clips. FP32 Parakeet matched all six development clips and five of six held-out clips, misreading “Read receipts” as “Greet receipts.” INT8 Parakeet omitted “dimmed” and “expanded,” and also misread two names. FP32 was added as a diagnostic after INT8 results, so it is not a blinded prespecified candidate.

All candidates were also run on the same twelve overlapping-hint recordings. Their full-transcript proxy scores are unsuitable as clean accuracy estimates because the reference omits preceding hint fragments. Critical-fact mismatches nevertheless remain visible: Whisper missed checked in one clip; FP32 Parakeet missed collapsed in one; INT8 Parakeet missed critical facts in four. No result from this stress batch is erased or promoted into a clean pass.

Raw Whisper invented “Thank you” on both digital-silence controls and “Thanks for watching” on the generated tone, in both batches. Both Parakeet precisions returned empty text on those three controls. The production observer's digital-silence guard prevents the two all-zero false transcripts before inference. It does not prevent nonzero-noise hallucination. A real CLI smoke check confirmed the adopted default reads “Send photo dimmed button”; another confirmed that digital silence abstains without loading the model. Both outputs remain explicitly unverified evidence.

Under the prespecified priority of critical facts, then reference agreement, then speed, **Whisper Large V3 is the default for detailed known-speech accessibility transcript review**. FP32 Parakeet remains an explicit fast cross-check. This is a fidelity tradeoff: Whisper preserved names better in this small corpus, while Parakeet was faster and handled the negative controls better. Neither is a standalone speech-delivery or accessibility acceptance gate. Compare each transcript with genuine reader text and action timing; unexpected text, missing state, disagreement or absent evidence is inconclusive and requires review. Do not treat generated non-speech text as an app announcement.

`local-asr-default.json` records the selected model, revision, scope and limitations. The normal WAV observer now uses it when no backend/model overrides are supplied. It does not silently fall back to a different recognizer. Reopen this choice for another voice, speaking rate, language, reader/platform, decoding change or contradictory recording.

The experiment executed 96 raw recognitions: three candidate runtime configurations across two shared sixteen-clip manifests. The sixteen inputs per manifest are twelve reader clips, two actual digital-silence controls, one generated tone and one exploratory prior calibration with overlap. There are 24 valid new reader recordings plus one retained rejected target recording; these counts do not represent 96 accessibility passes.

VoiceOver was restored off, instructional hints on, the Utility category to General and Settings to Bluetooth. The owned tab and listener were closed, other tabs preserved, and no capture/reader process remained. Existing approved grants were preserved. Ten Python regression/observer checks passed; no capture/MCP source changed in this experiment.

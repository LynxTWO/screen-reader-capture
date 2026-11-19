"""Optional local calibration observer. No audio upload or model download here."""
import argparse
import json
import wave
from pathlib import Path


def pcm_samples(path):
    with wave.open(str(path), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
            raise ValueError('Only mono, 16-bit PCM at 16000Hz is supported')
        if audio.getnframes() > 30 * 16000:
            raise ValueError('Calibration input exceeds thirty seconds')
        return audio.readframes(audio.getnframes())


def observe(path, model_path, transcribe=None, backend='whisper'):
    pcm = pcm_samples(path)
    # A real silent control exposed Whisper hallucination. Abstain before inference.
    if not pcm or not any(pcm):
        return {'origin': 'digital_silence_guard', 'status': 'no_audio_frames' if not pcm else 'digital_silence',
                'segments': [], 'audio': str(path), 'spokenWordsVerified': False}
    if transcribe is None:
        import numpy as np
        from local_asr import load_engine
        recognize, identity = load_engine(backend, model_path)
        samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
        prediction = recognize(samples)
        result = prediction['segments']
        text = prediction['text']
    else:
        result = transcribe(pcm)
        text = ''.join(s['text'] for s in result).strip()
        identity = {'engine': 'injected_test_observer'}
    return {'origin': 'local_audio_transcription', **identity,
            'model': str(model_path), 'audio': str(path), 'status': 'unverified_transcription',
            'text': text, 'segments': result, 'spokenWordsVerified': False,
            'limits': 'Automatic transcription can be wrong. Not a human hearing report or pronunciation judgment.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audio', type=Path)
    parser.add_argument('--model', type=Path)
    parser.add_argument('--backend', choices=['whisper', 'parakeet', 'parakeet-fp32'])
    args = parser.parse_args()
    selected = None
    if args.model:
        backend, model = args.backend or 'whisper', args.model
    elif args.backend:
        parser.error('--backend requires --model; omit both to use the evaluated default')
    else:
        root = Path(__file__).resolve().parents[1]
        selected = json.loads((root / 'local-asr-default.json').read_text())
        backend, model = selected['backend'], root / selected['modelDirectory']
    result = observe(args.audio, model, backend=backend)
    if selected:
        result['defaultQualification'] = {key: selected[key] for key in
                                          ['scope', 'knownLimitations', 'transcriptIsAcceptanceVerdict']}
    print(json.dumps(result, indent=2))

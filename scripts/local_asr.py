"""Local-only recognizers for bounded reader WAVs; no enhancement or prompts."""
import os
import time
from pathlib import Path


def load_engine(backend, model_path):
    model_path = Path(model_path).resolve(strict=True)
    if not model_path.is_dir():
        raise ValueError('A prepared local model directory is required')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    started = time.perf_counter()
    if backend == 'whisper':
        from faster_whisper import WhisperModel
        model = WhisperModel(str(model_path), device='cpu', compute_type='int8',
                             cpu_threads=4, num_workers=1, local_files_only=True)

        def recognize(samples):
            segments, _ = model.transcribe(samples, language='en', beam_size=5, temperature=0,
                                            condition_on_previous_text=False, vad_filter=False)
            result = [{'start': s.start, 'end': s.end, 'text': s.text,
                       'noSpeechProbability': s.no_speech_prob} for s in segments]
            return {'text': ''.join(s['text'] for s in result).strip(), 'segments': result}
        identity = 'faster-whisper1.2.1/cpu-int8/threads4/beam5/en'
    elif backend in ('parakeet', 'parakeet-fp32'):
        import onnx_asr
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.inter_op_num_threads = 1
        quantization = 'int8' if backend == 'parakeet' else None
        model = onnx_asr.load_model('nemo-parakeet-tdt-0.6b-v3', str(model_path),
                                   quantization=quantization, sess_options=options,
                                   providers=['CPUExecutionProvider'])

        def recognize(samples):
            return {'text': model.recognize(samples, sample_rate=16000), 'segments': None}
        identity = 'onnx-asr0.12.0/parakeet-v3/cpu-' + (quantization or 'fp32') + '/threads4/greedy'
    else:
        raise ValueError('Unsupported local backend')
    return recognize, {'engine': identity, 'model': str(model_path),
                       'loadSeconds': time.perf_counter() - started,
                       'enhancement': False, 'expectedTextPrompt': False}

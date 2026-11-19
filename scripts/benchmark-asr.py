"""Run one local backend on frozen identical clips; preserve raw silence results."""
import argparse
import hashlib
import importlib.util
import json
import socket
import time
from pathlib import Path
from asr_metrics import compare
from local_asr import load_engine


def refuse_network(*args, **kwargs):
    raise RuntimeError('Network is disabled during benchmark inference')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--backend', choices=['whisper', 'parakeet', 'parakeet-fp32'], required=True)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    if args.output.exists():
        raise FileExistsError(args.output)
    socket.socket.connect = refuse_network
    socket.socket.connect_ex = refuse_network
    socket.create_connection = refuse_network
    import numpy as np
    spec = importlib.util.spec_from_file_location('observer', Path(__file__).with_name('transcribe-wav.py'))
    observer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(observer)
    recognize, identity = load_engine(args.backend, args.model)
    result = {'identity': identity, 'manifestSha256': hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
              'network': 'socket connections denied for inference', 'rawInferenceOnSilence': True,
              'spokenWordsVerified': False, 'clips': []}
    for clip in manifest['clips']:
        path = Path(clip['audio'])
        if hashlib.sha256(path.read_bytes()).hexdigest() != clip['sha256']:
            raise ValueError('Changed audio: ' + clip['id'])
        samples = np.frombuffer(observer.pcm_samples(path), dtype='<i2').astype(np.float32) / 32768
        started = time.perf_counter()
        prediction = recognize(samples)
        elapsed = time.perf_counter() - started
        item = {'id': clip['id'], 'split': clip['split'], 'kind': clip['kind'],
                'inferenceSeconds': elapsed, **prediction}
        if clip['kind'] == 'reader':
            item['agreement'] = compare(clip['reference'], prediction['text'])
        result['clips'].append(item)
        print(json.dumps({'id': clip['id'], 'seconds': elapsed, 'text': prediction['text']}), flush=True)
        # Incremental evidence survives a later failure; fresh output is required.
        args.output.write_text(json.dumps(result, indent=2) + '\n')

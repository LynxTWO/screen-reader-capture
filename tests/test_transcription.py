import importlib.util
import tempfile
import unittest
import wave
from pathlib import Path

spec = importlib.util.spec_from_file_location('observer', Path(__file__).parents[1] / 'scripts/transcribe-wav.py')
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class ObserverTests(unittest.TestCase):
    def wav(self, samples, channels=1):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / 'control.wav'
        with wave.open(str(path), 'wb') as f:
            f.setnchannels(channels)
            f.setsampwidth(2)
            f.setframerate(16000)
            f.writeframes(samples)
        return path

    def test_silence_never_calls_hallucinating_observer(self):
        def hallucinate(_):
            self.fail('Silent audio reached inference')
        result = observer.observe(self.wav(bytes(3200)), None, hallucinate)
        self.assertEqual(result['status'], 'digital_silence')
        self.assertEqual(result['segments'], [])

    def test_empty_is_not_a_speech_pass(self):
        result = observer.observe(self.wav(b''), None, lambda _: self.fail('empty inference'))
        self.assertEqual(result['status'], 'no_audio_frames')
        self.assertFalse(result['spokenWordsVerified'])

    def test_nonzero_transcript_remains_an_unverified_observation(self):
        result = observer.observe(self.wav(b'\x01\x00' * 100), None, lambda _: [{'text': 'observed text'}])
        self.assertEqual(result['segments'][0]['text'], 'observed text')
        self.assertFalse(result['spokenWordsVerified'])

    def test_wrong_format_refused(self):
        with self.assertRaises(ValueError):
            observer.observe(self.wav(bytes(3200), channels=2), None)


if __name__ == '__main__':
    unittest.main()

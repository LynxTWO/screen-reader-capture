import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
from asr_metrics import compare


class AgreementTests(unittest.TestCase):
    def test_number_and_reader_spelling_only_normalization(self):
        result = compare('10 seconds. VoiceOver. Checkbox.', 'Ten seconds, voice over, check box')
        self.assertEqual(result['wordEdits'], 0)

    def test_negation_loss_cannot_pass_on_similar_words(self):
        result = compare('Message not sent. Button.', 'Message sent. Button.')
        self.assertEqual(result['missingCriticalFacts'], ['not sent'])
        self.assertEqual(result['extraCriticalFacts'], ['sent'])

    def test_unchecked_and_checked_are_opposites(self):
        result = compare('Notifications. Not checked. Checkbox.', 'Notifications. Checked. Checkbox.')
        self.assertEqual(result['missingCriticalFacts'], ['unchecked'])
        self.assertEqual(result['extraCriticalFacts'], ['checked'])

    def test_added_selected_state_is_an_error(self):
        self.assertEqual(compare('30 seconds toggle button', '30 seconds selected toggle button')['extraCriticalFacts'], ['selected'])

    def test_wrong_duration_is_not_normalized_away(self):
        result = compare('Ten seconds', 'Thirty seconds')
        self.assertEqual(result['wordEdits'], 1)
        self.assertEqual(result['missingCriticalFacts'], ['ten seconds'])

    def test_send_photo_spelling_error_is_not_a_delivery_status_claim(self):
        result = compare('Send photo dimmed button', 'Sent photo dimmed button')
        self.assertEqual(result['wordEdits'], 1)
        self.assertEqual(result['extraCriticalFacts'], [])


if __name__ == '__main__':
    unittest.main()

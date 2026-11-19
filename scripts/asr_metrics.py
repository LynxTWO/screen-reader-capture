"""Transparent reader-text agreement metrics; not heard-audio ground truth."""
import re


def words(text):
    text = re.sub(r'\bvoiceover\b', 'voice over', text.lower())
    text = re.sub(r'\bcheckbox\b', 'check box', text)
    tokens = re.findall(r"[a-z0-9]+", text)
    numbers = {'10': 'ten', '30': 'thirty'}
    return [numbers.get(t, t) for t in tokens]


def edit_distance(reference, observed):
    previous = list(range(len(observed) + 1))
    for i, expected in enumerate(reference, 1):
        current = [i]
        for j, actual in enumerate(observed, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j-1] + (expected != actual)))
        previous = current
    return previous[-1]


def facts(text):
    text = ' ' + ' '.join(words(text)) + ' '
    out = set()
    for value in ['collapsed', 'expanded', 'dimmed', 'disabled', 'toggle button',
                  'check box', 'ten seconds', 'thirty seconds']:
        if ' ' + value + ' ' in text:
            out.add('dimmed' if value == 'disabled' else value)
    if ' toggle button ' not in text and ' button ' in text:
        out.add('button')
    if any(v in text for v in [' not checked ', ' unchecked ']):
        out.add('unchecked')
    elif ' checked ' in text:
        out.add('checked')
    if any(v in text for v in [' not selected ', ' unselected ']):
        out.add('unselected')
    elif ' selected ' in text:
        out.add('selected')
    if ' message not sent ' in text:
        out.add('not sent')
    elif ' message sent ' in text:
        out.add('sent')
    return out


def compare(reference, observed):
    expected, actual = words(reference), words(observed)
    wanted, got = facts(reference), facts(observed)
    return {'referenceWords': len(expected), 'wordEdits': edit_distance(expected, actual),
            'missingCriticalFacts': sorted(wanted - got),
            'extraCriticalFacts': sorted(got - wanted),
            'referenceKind': 'reader_api_text_proxy_not_heard_audio'}

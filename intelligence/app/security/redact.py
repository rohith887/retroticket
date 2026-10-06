"""Second, independent redaction pass. Node already sanitizes before sending; this checks again on the Python side.

Nothing is trusted: every message text and every string field is redacted before a prompt is built. The patterns overlap
with Node on purpose (defence in depth) and add ones Node does not cover: provider API keys, credentials embedded in
URLs, 24-character hex ids (database user ids) and IP addresses. Names cannot be found by patterns; Node replaces them
with placeholders before sending, and the validators refuse output that contains anything unexpected.

Only counts are returned for logging. The removed text is never kept.
"""
from __future__ import annotations

import re
from collections import Counter

PLACEHOLDER_CUSTOMER = "{{customer_name}}"

# Order matters: more specific patterns first.
_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("secret", re.compile(r"\b(?:authorization\s*[:=]\s*)?(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}", re.IGNORECASE), "[secret]"),
    ("secret", re.compile(r"\b(?:token|api[-_ ]?key|secret|password|passcode|pwd|authorization)\b\s*[:=]\s*\S+", re.IGNORECASE), "[secret]"),
    ("secret", re.compile(r"\b(?:password|passcode|pwd|pin|api[-_ ]?key|secret|token)\s+(?:is|was|are|=)\s+\S+", re.IGNORECASE), "[secret]"),
    ("token", re.compile(r"\beyJ[\w-]+\.[\w-]+\.[\w-]+\b"), "[token]"),
    ("token", re.compile(r"\b(?:sk|pk|rk|xox[abpr]|ghp|gho|AKIA|AIza)[-_A-Za-z0-9]{12,}\b"), "[token]"),
    ("credential_url", re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s/@:]+:[^\s/@]+@\S+", re.IGNORECASE), "[link]"),
    ("email", re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b"), "[email]"),
    ("link", re.compile(r"\b(?:https?://|www\.)\S+", re.IGNORECASE), "[link]"),
    ("ip", re.compile(r"(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)"), "[ip]"),
    ("id", re.compile(r"\b[0-9a-f]{24}\b", re.IGNORECASE), "[id]"),
    ("number", re.compile(r"(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)"), "[number]"),
    ("number", re.compile(r"\b\d{6,}\b"), "[number]"),
]


def redact(text: str) -> tuple[str, Counter]:
    """Returns (redacted text, counts by kind). Idempotent: running it on its own output changes nothing."""
    counts: Counter = Counter()
    out = text
    for kind, pattern, replacement in _PATTERNS:
        out, n = pattern.subn(replacement, out)
        if n:
            counts[kind] += n
    return out, counts

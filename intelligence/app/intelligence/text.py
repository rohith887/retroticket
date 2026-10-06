"""Text helpers shared by the rule engines. Pure functions, no I/O."""
from __future__ import annotations

import re
from functools import lru_cache

_QUOTED_LINE = re.compile(r"^\s*>.*$", re.MULTILINE)
_WROTE_TAIL = re.compile(r"\n\s*on .{5,120}wrote:.*\Z", re.IGNORECASE | re.DOTALL)
_SPACES = re.compile(r"[ \t\r\f\v]+")

NEGATORS = re.compile(r"\b(?:not|never|no|isn't|wasn't|aren't|don't|doesn't|didn't|hardly|without)\s+(?:\w+\s+)?$")


def clean(text: str) -> str:
    """The customer's own words: quoted reply lines and the 'On ... wrote:' tail are dropped, whitespace collapsed."""
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = _WROTE_TAIL.sub("", text)
    text = _QUOTED_LINE.sub("", text)
    return _SPACES.sub(" ", text).strip()


@lru_cache(maxsize=2048)
def phrase_regex(phrase: str) -> re.Pattern[str]:
    """Whole-word match. A trailing '*' allows any word ending (fail* matches fail, failed, failure)."""
    stem = phrase.endswith("*")
    body = re.escape(phrase.rstrip("*").lower())
    body = body.replace(r"\ ", r"\s+")
    return re.compile(rf"(?<!\w){body}{r'\w*' if stem else ''}(?!\w)")


def find(text_lower: str, phrase: str) -> list[re.Match[str]]:
    return list(phrase_regex(phrase).finditer(text_lower))


def negated(text_lower: str, start: int) -> bool:
    """True when a negator sits within the two words before position `start` ("not good", "wasn't very helpful")."""
    return bool(NEGATORS.search(text_lower[max(0, start - 30):start]))

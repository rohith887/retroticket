"""Preprocessing and feature extraction: text in, cleaned sentences and per-sentence features out.

Order for each message: clean (quoted replies, "On ... wrote:" tails), redact contact data and secrets (second pass; Node
already sanitized), detect system-generated mail using the knowledge pack (bounce notices, OTP mail), split sentences,
compute features. Linguistic function words (negation cues, pronouns, number words) are language constants and live here;
all domain vocabulary comes from the knowledge pack.
"""
from __future__ import annotations

import re

from app.engine.model import ROLE_TO_PARTY, ConversationInput, InputMessage, ProcessedMessage, Sentence, SentenceFeatures
from app.intelligence.text import clean, find
from app.knowledge.loader import IndicatorSet
from app.security.redact import redact

MAX_SENTENCES_PER_MESSAGE = 40

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_TOKEN = re.compile(r"[A-Za-z0-9']+")
_NEGATION = re.compile(r"\b(?:not|no|never|cannot|can't|cant|won't|don't|doesn't|didn't|hasn't|haven't|hadn't|isn't|aren't|wasn't|weren't|without)\b", re.IGNORECASE)
_PRONOUN = re.compile(r"\b(?:it|this|that|they|them|these|those)\b", re.IGNORECASE)

NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12}
_COUNT = re.compile(r"\b(?P<n>\d{1,3}|" + "|".join(NUMBER_WORDS) + r")\s+times?\b|\b(?P<w>once|twice|thrice)\b", re.IGNORECASE)
_WORD_COUNTS = {"once": 1, "twice": 2, "thrice": 3}


def split_sentences(message_id: str, text: str) -> list[Sentence]:
    sentences: list[Sentence] = []
    position = 0
    for part in _SENTENCE_SPLIT.split(text):
        if part is None:
            continue
        start = text.find(part, position) if part else position
        position = start + len(part)
        stripped = part.strip()
        if not stripped:
            continue
        offset = start + (len(part) - len(part.lstrip()))
        sentences.append(Sentence(message_id, len(sentences), offset, offset + len(stripped), stripped))
        if len(sentences) >= MAX_SENTENCES_PER_MESSAGE:
            break
    return sentences


def extract_counts(text: str) -> tuple[tuple[int, int, int], ...]:
    out = []
    for m in _COUNT.finditer(text):
        raw = m.group("n") or m.group("w")
        value = _WORD_COUNTS.get(raw.lower()) or NUMBER_WORDS.get(raw.lower()) or int(raw)
        out.append((value, m.start(), m.end()))
    return tuple(out)


def sentence_features(sentence: Sentence, indicators: IndicatorSet) -> SentenceFeatures:
    lower = sentence.text.lower()
    markers = indicators.phrases("message.open_request") + indicators.optional("message.open_request_extra")
    return SentenceFeatures(
        message_id=sentence.message_id,
        index=sentence.index,
        is_question=sentence.text.rstrip().endswith("?"),
        has_request_marker=any(find(lower, phrase) for phrase in markers),
        has_pronoun=bool(_PRONOUN.search(sentence.text)),
        tokens=len(_TOKEN.findall(sentence.text)),
        counts=extract_counts(sentence.text),
        negations=tuple(m.start() for m in _NEGATION.finditer(sentence.text)),
    )


def detect_automated(text: str, indicators: IndicatorSet) -> str | None:
    lower = text.lower()
    for phrase in indicators.phrases("message.automated"):
        if find(lower, phrase):
            return phrase
    return None


def preprocess_message(message: InputMessage, indicators: IndicatorSet) -> ProcessedMessage:
    cleaned = clean(message.text)
    redacted, counts = redact(cleaned)
    reason = detect_automated(redacted, indicators)
    party = "automated" if reason else ROLE_TO_PARTY.get(message.role, "system")
    sentences = split_sentences(message.id, redacted)
    features = tuple(sentence_features(s, indicators) for s in sentences)
    return ProcessedMessage(message.id, party, redacted, tuple(sentences), features, reason, sum(counts.values()), message.at)


def preprocess(conversation: ConversationInput, indicators: IndicatorSet) -> list[ProcessedMessage]:
    return [preprocess_message(m, indicators) for m in conversation.messages]

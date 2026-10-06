def label(analyze, text):
    return analyze(text, "/api/v1/sentiment")["sentiment"]


def test_positive(analyze):
    result = label(analyze, "Thank you so much, this is perfect and very helpful.")
    assert result["label"] == "positive" and result["confidence"] >= 0.7


def test_neutral_has_low_confidence(analyze):
    result = label(analyze, "Please share the report format for next week.")
    assert result == {"label": "neutral", "confidence": 0.5}


def test_negative(analyze):
    assert label(analyze, "The document was rejected and I am disappointed.")["label"] == "negative"


def test_frustrated(analyze):
    result = label(analyze, "I have already submitted this document three times and nobody has fixed the problem.")
    assert result["label"] == "frustrated" and result["confidence"] >= 0.85


def test_negation_flips_a_positive_word(analyze):
    assert label(analyze, "This is not good.")["label"] == "negative"
    assert label(analyze, "This is good.")["label"] == "positive"


def test_quoted_reply_text_is_ignored(analyze):
    text = "Thanks, that works now.\n> You: this is unacceptable and ridiculous\n> nobody answered"
    assert label(analyze, text)["label"] == "positive"


def test_shouting_and_punctuation_count_as_frustration(analyze):
    assert label(analyze, "WHY IS THIS STILL BROKEN?? FIX IT NOW!!")["label"] == "frustrated"


def test_deterministic(analyze):
    text = "Nobody has replied and this is unacceptable!"
    results = [label(analyze, text) for _ in range(5)]
    assert all(r == results[0] for r in results)

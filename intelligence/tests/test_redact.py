import pytest

from app.security.redact import redact

CANARIES = {
    "email": "priya.sharma@example.com",
    "phone": "+91 98765 43210",
    "long number": "20260606142029642",
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "api key": "sk-proj-abcdefghijklmnop123456",
    "aws key": "AKIAIOSFODNN7EXAMPLE",
    "user id": "665f1c2ab3d4e5f6a7b8c9d0",
    "link": "https://portal.example.com/reset?token=abc123",
    "ip": "192.168.10.24",
    "credential url": "mongodb://admin:hunter2@db.internal:27017/pp",
}


@pytest.mark.parametrize("name,value", list(CANARIES.items()))
def test_each_kind_of_sensitive_value_is_removed(name, value):
    out, counts = redact(f"before {value} after")
    assert value not in out, f"{name} survived: {out}"
    assert counts, "a redaction should be counted"
    assert "before" in out and "after" in out


def test_password_and_bearer_values_are_removed():
    out, _ = redact("my password: hunter2 and Authorization: Bearer abcDEF123456")
    assert "hunter2" not in out and "abcDEF123456" not in out


def test_spoken_style_secrets_are_removed():
    for text in ("my password is hunter2 please", "the api key is abcd1234efgh", "pin is 4921"):
        out, _ = redact(text)
        assert "hunter2" not in out and "abcd1234efgh" not in out and "4921" not in out, out


def test_ordinary_sentences_about_tokens_and_passwords_keep_their_meaning():
    out, _ = redact("The link expired and I forgot how to reset it.")
    assert out == "The link expired and I forgot how to reset it."


def test_ordinary_text_is_untouched():
    text = "I have already submitted this document three times."
    assert redact(text) == (text, redact(text)[1]) and not redact(text)[1]


def test_redaction_is_idempotent():
    once, _ = redact(f"reach me at {CANARIES['email']} or {CANARIES['phone']}")
    twice, counts = redact(once)
    assert once == twice and not counts


def test_counts_never_contain_the_removed_text():
    _, counts = redact(f"x {CANARIES['email']} y")
    assert all(isinstance(key, str) and "@" not in key for key in counts)

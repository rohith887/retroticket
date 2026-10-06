# Ticketer intelligence service

A small FastAPI service that reads a customer message and returns **insights**: sentiment, intent and a priority
*suggestion*, each with a confidence and (for priority) short reasons.

> **Python is an intelligence service, not the application's business-logic owner.**
> Node.js owns tickets, conversations, messages, users, permissions, assignments, statuses, priorities, email and
> notifications. MongoDB is the source of truth. This service never reads or writes any of it: it receives text and
> returns an opinion. Node decides what to do with that opinion.

The service, its contract, authentication, limits and a deterministic local provider are **Phase 1**. The Node side
(calling this service, timeouts and failure handling, storing `AiInsight`, accept / dismiss) is **Phase 2** and is
described in `apps/api/AI_INTEGRATION.md`, including exactly what data is sent here. The internal fact and state engine is Phase 3A; summaries and reply drafts
come later.

## Architecture

```
React ──► Node.js / Express ──► MongoDB
               │
               │  HTTP, Authorization: Bearer <INTERNAL_SERVICE_TOKEN>
               ▼
         Python FastAPI (this service)  ──►  AIProvider  (Phase 1: local rules)
```

* The browser never calls this service. Only the Node API does, on the same machine or a private network.
* No MongoDB, no Redis, no external AI provider, no outbound network calls. The service runs on its own.
* If this service is down or slow, ticketing must keep working. Node treats it as optional (Phase 2).

Inside the service:
`HTTP request → body-size limit → request id → route → auth → rate limit → Pydantic validation → provider → Pydantic response`.
Routes contain no rules; all logic sits behind the `AIProvider` interface (`app/providers/base.py`).

## Directory structure

```
apps/intelligence/
  app/
    main.py                  application factory, error handlers, middleware
    config.py                settings from environment variables
    api/
      dependencies.py        auth + rate limit + timing/logging wrapper for every intelligence route
      routes/health.py       GET /health, GET /ready
      routes/analysis.py     POST /api/v1/analyze-message | sentiment | intent | priority, GET /api/v1/intents
      schemas/analysis.py    Pydantic request/response models (the Node <-> Python contract)
    providers/               base.py (AIProvider), local_rules.py (Phase 1), registry.py
    intelligence/            rule engines: sentiment.py intent.py priority.py text.py (driven by the knowledge pack)
    knowledge/               schema.py, loader.py (validation, fingerprint)
    engine/                  model.py, preprocess.py, interfaces.py, registry.py, pipeline.py, realise.py, snapshot.py, components/rules.py
    evaluation/              dataset.py, metrics.py, runner.py (python -m app.evaluation)
    security/                auth.py (bearer token), limits.py (body size, rate limit)
    utils/                   errors.py (error envelope), logging.py (content-free logs, request ids)
  knowledge/packs/           versioned knowledge packs (JSON)
  evaluation/golden/         golden cases
  tests/                     pytest suite
  requirements.txt           runtime: fastapi, uvicorn, pydantic
  requirements-dev.txt       adds pytest and httpx
```

## Requirements and install

Python 3.11 or newer (developed on 3.14). Runtime packages: `fastapi`, `uvicorn`, `pydantic` v2. Nothing else.

```bash
cd apps/intelligence
python -m venv .venv
.venv\Scripts\activate                 # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt    # requirements.txt in production
```

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `INTERNAL_SERVICE_TOKEN` | none, **required** | Shared secret Node sends as a bearer token. At least 16 characters. |
| `HOST` / `PORT` | `127.0.0.1` / `8100` | Bind address for `python -m app.main`. Keep it on localhost. |
| `AI_PROVIDER` | `local_rules` | Which provider to use. |
| `INTENTS_FILE` | pack file | Path to a custom intents JSON file. |
| `KNOWLEDGE_PACK` / `KNOWLEDGE_DIR` | `verification-support` / `knowledge/packs` | Which knowledge pack to load. |
| `KNOWLEDGE_REQUIRE_APPROVED` | `false` | When true a draft pack keeps the service not ready. |
| `ENGINE_COMPONENTS` | empty | Optional component overrides, `role=name,...`. |
| `MAX_BODY_BYTES` | `65536` | Larger bodies get `413` before parsing. |
| `MAX_TEXT_CHARS` | `8000` | Longer `text` gets `413`. |
| `RATE_LIMIT_PER_MINUTE` | `120` | Per caller; `0` disables. |
| `LOG_LEVEL` | `INFO` | |

With an invalid configuration (no token, unknown provider, broken intents file) the process still starts, `/health`
stays up, `/ready` returns `503` with the reasons, and every intelligence endpoint returns `503`. It never falls back
to open access.

## Run and test

```bash
set INTERNAL_SERVICE_TOKEN=dev-token-0123456789abcdef          # PowerShell: $env:INTERNAL_SERVICE_TOKEN = "..."
python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
python -m pytest
```

## API (version 1)

Every endpoint except `/health` and `/ready` requires `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`. An optional
`X-Request-ID` (8 to 64 characters of `A-Z a-z 0-9 . _ -`) is kept; otherwise one is generated. It is returned as a header
and in `meta.requestId`.

| Method and path | Purpose |
|---|---|
| `GET /health` | Liveness. `{"status":"ok"}` while the process is up. |
| `GET /ready` | `200` when configuration is valid and the provider is built, else `503` with `problems`. |
| `POST /api/v1/analyze-message` | Sentiment, intent and priority suggestion together. |
| `POST /api/v1/sentiment` | Sentiment only. |
| `POST /api/v1/intent` | Intent only. |
| `POST /api/v1/priority` | Priority **suggestion** only. |
| `GET /api/v1/intents` | The configured intent categories. |

Request (unknown fields are rejected, `text` must not be blank; the three ids are optional and used only for log correlation):

```json
{ "ticketId": "665f...", "conversationId": "665f...", "messageId": "665f...", "text": "I have already submitted this document three times and nobody has fixed the problem." }
```

Response of `POST /api/v1/analyze-message`:

```json
{
  "sentiment": { "label": "frustrated", "confidence": 0.92 },
  "intent": { "label": "document_issue", "confidence": 0.71, "alternatives": [] },
  "priority": {
    "label": "high",
    "confidence": 0.78,
    "reasons": ["Repeated failed attempts or no response so far", "Customer reports an error or unresolved issue", "Customer appears frustrated"]
  },
  "meta": { "provider": "local_rules", "model": "rules-lexicon", "version": "1.0", "latencyMs": 1.6, "requestId": "45338b05..." }
}
```

```bash
curl -s http://127.0.0.1:8100/api/v1/analyze-message -H "Authorization: Bearer $INTERNAL_SERVICE_TOKEN" \
  -H "Content-Type: application/json" -d '{"text": "Any update on the status of my case?"}'
```

Labels: sentiment `positive | neutral | negative | frustrated`; priority `low | medium | high | critical`; intent is one
of the configured categories.

### Errors

One envelope for every failure: `{ "error": { "code", "message", "requestId", "details"? } }`. Messages are fixed
strings. Message text, stack traces and secrets are never returned.

| Status | code | When |
|---|---|---|
| 401 | `unauthorized` | Missing or malformed `Authorization` header. |
| 403 | `forbidden` | Token present but wrong. |
| 413 | `payload_too_large` | Body over `MAX_BODY_BYTES`, or `text` over `MAX_TEXT_CHARS`. |
| 422 | `validation_error` | Malformed JSON, missing or blank `text`, unknown field, wrong type. `details` names fields, never values. |
| 429 | `rate_limited` | Over the per-minute limit (`Retry-After` is set). |
| 502 | `provider_error` | The provider failed; the cause is logged by type only. |
| 503 | `service_not_configured` | Invalid configuration (see `/ready`). |
| 500 | `internal_error` | Anything unexpected, without a stack trace. |

## The intelligence engine (Phase 3A)

An internal, deterministic engine. No language model, no external AI, no network. Pipeline order (each stage only depends
on the ones before it):

```
Knowledge pack -> Preprocessing -> Features -> Extraction (entity, action, outcome) -> Facts -> Conversation state
                                            \-> Sentiment / Intent / Priority (existing rule engines, now pack-driven)
```

* **Knowledge** (`knowledge/packs/<id>/*.json`, loaded by `app/knowledge`): pack.json (id, version, `status: draft|approved`),
  intents, indicators (phrase groups and patterns), entities, actions, outcomes, states (ordered rules), realisation
  (fixed templates). Every entry says where it came from (`origin`) and its `review` level (`approved`, `established`,
  `needs_review`). The shipped pack `verification-support` is a **draft** built only from existing code, stored data and
  lexicons; uncertain vocabulary (for example `passport`, `contact verification`) is flagged `needs_review`. A pack can only
  be `approved` when every entry is approved; `KNOWLEDGE_REQUIRE_APPROVED=true` refuses a draft. Loading is deterministic,
  strict (unknown fields rejected, cross-file checks) and happens at startup: an invalid pack keeps `/ready` at 503 and every
  intelligence endpoint at 503. Each pack has a fingerprint `id@version+contenthash` recorded with every result.
* **Components** (`app/engine/interfaces.py`, `registry.py`): sentiment, intent, priority, entity/action/outcome extractors,
  fact builder and state detector. Each exposes `info` (name, version) and returns explainable signals. A trained model can
  later replace one component (register it, select it with `ENGINE_COMPONENTS`) without changing the API.
* **Facts** (`app/engine/model.py`): a customer statement is a **claim** and is never converted to a verified fact. Only the
  structured ticket data and events Node supplies produce **verified** facts. Facts hold knowledge ids, count, polarity and
  provenance (message id, sentence index, character span, extracting component and version, knowledge fingerprint), never raw
  customer text. Messages from bounce or OTP mail are marked `automated` and ignored.
* **State** (`states.json`): `resolved | awaiting_customer | awaiting_support | unresolved | unknown`, chosen by ordered rules
  R1..R7; first match wins; no match gives `unknown`. Rules that are inferences are flagged `needs_review`.
* **Realiser** (`app/engine/realise.py`): fixed templates over facts, for Phase 3B. It says nothing that is not in a fact.
* **Endpoint**: `POST /api/v1/analyze-conversation` takes `ticket {status, priority?, isResolved}`, `messages[1..60]`,
  `events[0..50]` and returns sentiment, intent, priority, entities, facts, pending items, state, a content-free
  `featureSnapshot`, and the engine, knowledge and component versions.
* **Evaluation** (`python -m app.evaluation`): runs the engine over `evaluation/golden/cases.json`. Expected values live only
  there, never in the pack. Output is raw counts per dimension, split by curation level, plus mismatches and skipped
  (ambiguous) cases. All cases are currently `proposed`, so the report states that it is not an accuracy measure.
* **Removed**: the LLM provider abstraction, the fake provider, `/api/v1/summarize`, and all `LLM_*` settings.

## Reply drafting (Phase 3C)

`POST /api/v1/reply-draft` returns an **editable draft or a structured refusal**. It never sends anything and never changes anything.

* **Knowledge**: reply wording lives in its own versioned file, `knowledge/replies/<pack>/replies.json` (id
  `verification-support-replies`, draft, every pattern `needs_review`). The verification-support pack is not modified and keeps its
  fingerprint. The file is validated at startup like the pack (strict schema, cross-checks against the pack, unsafe phrases rejected
  at load time); an invalid or missing file keeps `/ready` at 503. `REPLY_PATTERNS_FILE` overrides the location.
* **Generator** (`app/engine/reply.py`, component `rules-reply`): answers only the customer messages since the last agent message.
  It restates customer *claims* ("You mentioned that ..."), states the ticket status Node supplied for status requests, and asks
  clarifying questions. No pattern promises, confirms receipt or outcome, quotes a time, links, or states policy.
* **Refusals** (`status: insufficient_context`, with `reason`): `no_customer_message`, `ambiguous_state` (only `awaiting_support`
  is drafted for), `unknown_intent`, `unsupported_request`, `missing_entity`, `no_safe_pattern`.
* **Provenance**: every sentence has `source { type: claim | verified_fact | pattern, patternId, factIds, messageId?, sentenceIndex? }`.
* **Validator** (fail closed): forbidden phrases, digits and dates, links and addresses, placeholders and internal markers, internal-note
  overlap, sources that do not match their facts, claim wording not hedged, knowledge words (entity, action, outcome) not supported by
  the source facts, tampered pattern text, length limits, stale sequence (`sequence.current > sequence.basedOn`). A failed draft is
  returned as `validation_failed` with check names only.
* Requests containing `internal_note` messages are refused with 422; there is no override. Python adds no greeting, name or signature.

## Security

* **Authentication:** bearer token, compared in constant time (both sides are hashed first, so length does not leak).
* **Network:** binds to `127.0.0.1` by default. Do not publish port 8100. The browser must never call it.
* **Limits:** body size (declared and streamed), text length, per-caller rate limit. Interactive docs and the OpenAPI
  schema are disabled.
* **Logging:** one JSON line per call with request id, operation, provider, model, latency, outcome and text length.
  **Message text is never logged**, and validation errors do not echo input.

## The local rules provider (Phase 1)

Deterministic: the same input always gives the same output. No model, no training, no network.

* **Sentiment**: word and phrase lexicons with negation ("not good" counts as negative), repeated-failure and anger
  phrases, shouting and punctuation. Quoted reply text (`> ...` lines, "On ... wrote:") is ignored.
* **Intent**: weighted keyword phrases per category from a JSON file. Highest score wins, ties go to the category listed
  first, no match gives the fallback category.
* **Priority**: points from urgency, legal threats, repeated failure, being blocked, deadlines, error/issue words and
  frustration. The keyword ideas from the old `email_worker.py` (urgent, critical, system down, outage, cannot access,
  security, data loss, error, issue, bug, slow, login) are one input among these; nothing else from that worker is reused.

The exact rules and thresholds are documented at the top of `app/intelligence/sentiment.py`, `intent.py` and
`priority.py`; the phrase lists are in `lexicons.py` and `intents.default.json`.

### What confidence means here

It is the **strength of the rule match**, not a probability, and it is not comparable to an ML or LLM score.

* a clear, high-signal match: higher (up to about 0.9)
* several weak signals: middle
* a single weak signal: capped around 0.5
* nothing matched, so the default label was used: low (intent `other` 0.30, priority `low` 0.40, sentiment `neutral` 0.50)

Treat low confidence as "no evidence", not as a 40% chance. Do not automate decisions from these values.

### Limits

* Keyword matching cannot understand context, sarcasm or unseen wording, and is tuned to English.
* Only the single message is analysed (no conversation history yet).
* The default intent categories are for the verification / applicant-support domain and are a starting point.

### Changing the intent categories

The default intents live in `knowledge/packs/verification-support/intents.json`. Point `INTENTS_FILE` at a JSON file shaped like it: a list of
`{ label, description, keywords: [{phrase, weight 1..3}], fallback? }`. Exactly one intent must have `"fallback": true`.
A trailing `*` in a phrase matches any word ending. No code change is needed.

## Replacing rules with trained models later

Two seams exist: `AIProvider` (single-message analysis) and the engine components (`app/engine/interfaces.py`). A trained
model is a new component that loads a model file from local disk at startup and is registered in `app/engine/registry.py`.
Routes, the Pydantic contract and everything Node relies on stay the same. Nothing leaves the server.

## Deployment

Run it as its own process next to the Node API, bound to localhost, with the token supplied by the process manager:

```bash
INTERNAL_SERVICE_TOKEN=<long random value> python -m uvicorn app.main:app --host 127.0.0.1 --port 8100 --workers 2
```

* Use the same value as `INTERNAL_SERVICE_TOKEN` in the Node API environment (wired up in Phase 2).
* Run it under PM2, systemd or a Windows service so it restarts. Health check: `GET /health`; readiness: `GET /ready`.
* Rate limiting is per process; several workers each keep their own counter, which is fine for a single Node caller.
* No Redis, database or model files are needed. Redis stays an optional future scaling layer for the platform and this
  service does not depend on it.

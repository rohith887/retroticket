# AI integration (Node side)

Node calls the Python intelligence service (`apps/intelligence`) for **suggestions**. Node stays the owner of tickets,
messages, permissions and every decision. The browser talks to Node only, never to Python.

```
React ──► Node /api/v1/ai/*  ──►  ai.service.js  ──HTTP + bearer token──►  Python /api/v1/analyze-message
                │
                └─► MongoDB: AiInsight (results), Activity (what a user accepted), AuditLog (accept / dismiss)
```

## Environment variables (Node API)

| Variable | Default | Meaning |
|---|---|---|
| `INTELLIGENCE_TOKEN` | none | Shared secret; must equal `INTERNAL_SERVICE_TOKEN` of the Python service. **AI is off until this is set.** |
| `INTELLIGENCE_URL` | `http://127.0.0.1:8100` | Where the Python service listens (keep it on localhost or a private network). |
| `AI_ENABLED` | on when a token is set | Set to `false` to switch AI off without removing the token. |
| `AI_TIMEOUT_MS` | `3000` | Per-call timeout (minimum 200). |
| `AI_FAILURE_THRESHOLD` | `3` | Consecutive failures before the circuit opens. |
| `AI_CIRCUIT_COOLDOWN_MS` | `30000` | How long calls are skipped once the circuit is open. |
| `AI_AUTO_ANALYZE` | `false` | When `true`, every incoming customer comment is analysed in the background. |

## API (all require a signed-in user)

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /api/v1/ai/status` | `issue::read` | `{ enabled, available }`. Lets the UI show or hide AI actions. Never an error. |
| `POST /api/v1/ai/tickets/:ticketId/analyze` | `issue::read` | Analyse the newest customer message (or `{ messageId }`, or the ticket description). Stores three `AiInsight` documents. If AI is unavailable the answer is `200 { success: false, available: false, reason }`. |
| `GET /api/v1/ai/tickets/:ticketId/insights` | `issue::read` | Latest analysis; `?history=1` for the last 60 insights. |
| `POST /api/v1/ai/insights/:id/accept` | `issue::update` | Accept a suggestion. A **priority** insight updates the ticket and writes a `priority_changed` event attributed to the user (`via: ai_suggestion`). Sentiment and intent are recorded as reviewed and change nothing. |
| `POST /api/v1/ai/insights/:id/dismiss` | `issue::update` | Dismiss a suggestion. |

Accept and dismiss are atomic: a suggestion can be handled once (`409` afterwards).

## Failure behaviour: AI can never break ticketing

Every function in `ai.service.js` resolves to `{ ok, ... }` and never throws. Ticket creation, message storing, replies
and assignment do not call the AI service at all; the optional background analysis runs after the message is saved and
cannot reject.

| Situation | Result |
|---|---|
| Not configured / disabled | No request is made. `reason: disabled`. |
| Service down (connection refused) | `unavailable` |
| Slower than `AI_TIMEOUT_MS` | `timeout` |
| Wrong credential | `unauthorized` (does not open the circuit, so a misconfiguration keeps showing up) |
| Rate limited (429) | `rate_limited` |
| Python 5xx | `provider_error` |
| Output does not match the contract (unknown label, confidence outside 0..1, bad JSON) | `invalid_response`, nothing is stored |
| Several failures in a row | `circuit_open`: calls are skipped for the cooldown, then one is tried again |

## What data leaves the application

Only when `INTELLIGENCE_TOKEN` is set, and only to `INTELLIGENCE_URL` (your own Python process; in Phase 1 that service
uses local rules and sends nothing further).

Sent for each analysis:

* the **customer message text**, sanitised: quoted reply lines removed, email addresses, phone numbers, links, long
  numbers (ids, cards), JWT / bearer tokens and `password: ...` style values replaced by placeholders, truncated to 6,000 characters
* the ticket id, and the message id (opaque identifiers)
* the service token in the `Authorization` header, and an optional request id

Never sent: customer or agent names and email addresses, ticket fields, other messages, mailbox or queue credentials,
authentication data, attachments.

There is no external AI provider. The intelligence engine is internal, deterministic and local: it uses no language model and makes no network calls.

## Stored data

`AiInsight` (one document per type per analysis): ticket and message references, `type` (`sentiment`, `intent`,
`priority`), the validated `result`, `confidence` and a `lowConfidence` flag (below 0.5), `provider`, `model`, `latencyMs`,
`requestId`, `engineVersion`, `knowledgeVersion` and `componentVersions` (which rules and knowledge produced it), a content-free `featureSnapshot` when available, `feedback` (`finalValue`, `editedAt`, `ignoredAt`, recorded for later review; nothing trains on it automatically), `status` (`suggested`, `accepted`, `dismissed`),
`acceptedBy` / `acceptedAt` / `dismissedBy` / `dismissedAt`, what was `applied`, and whether it was `manual` or `auto`.
The customer message itself is never modified. Accept and dismiss also write an `AuditLog` entry.

## Tests

`npm test` in `apps/api` runs the Node tests. The AI tests use a fake Python HTTP server and MongoDB
(`MONGODB_TEST_URI`, default `mongodb://localhost:27017/pp_test`; they skip when MongoDB is not reachable).

## Phase 3A: conversation analysis (internal engine)

Node builds a bounded, sanitized conversation with `buildConversationRequest` (`src/lib/ai/contextBuilder.js`) for
`POST /api/v1/analyze-conversation`. Node stays the authority: only ticket data Node records (`status`, `priority`,
`isResolved`) and events become **verified** facts in Python; everything a customer writes is a **claim**. Internal notes are
dropped unless `includeInternalNotes` is set, and a comment with `public: false` is always an internal note. Names are
replaced by placeholders and Python redacts a second time. The route, persistence and any UI for this come in Phase 3B; only
the request builder and the `AiInsight` fields exist now.

## Phase 3B: conversation summary

`POST /api/v1/ai/tickets/:id/summary` builds the context (internal notes excluded), calls `analyze-conversation`, validates the
response (`src/lib/ai/conversationContract.js`) and stores one `AiInsight` of type `summary`. `GET` returns the newest one with
`stale: true` when the ticket has newer messages than `basedOnSeq`. The same context, engine version and knowledge version reuse the
stored summary instead of creating a duplicate. The summary is a set of template sentences over facts, each line carrying the fact
ids and message ids it came from; customer statements read as claims, and lines resting on knowledge still marked `needs_review` are
flagged. Warnings say when the pack is a draft or an inferred state rule was used. The route changes nothing on the ticket and sends
nothing. The React Summary section lives in `apps/client/src/components/tickets/ai/AiSummary.jsx`. The knowledge pack is used as it
is: 3B made no knowledge change and resolved no review item.

## Phase 3C: reply drafts

`POST /api/v1/ai/tickets/:id/reply-draft` builds the context (internal notes excluded, no override), sends it with the conversation
sequence to `POST /api/v1/reply-draft`, validates the response with `src/lib/ai/replyContract.js` (strict shape plus an independent
safety check on the text) and stores one `AiInsight` of type `reply_draft` (`basedOnSeq`, `contextHash`, engine, knowledge and
component versions including the reply patterns, feature snapshot; no raw customer text). Node adds the greeting (customer first name,
letters only) and the signed-in agent's own signature; Python does not. If the ticket gets a new message while the engine works, the
draft is discarded (`stale_context`). `GET` returns the newest open draft with `stale: true` once the ticket has newer messages; a stale
draft is never reused. Refusals and failures create no insight. `POST /api/v1/ai/insights/:id/feedback` records `used_unchanged`,
`used_edited` or `dismissed` (with an audit entry) for later review; nothing trains on it and it is not treated as ground truth.

The AI never sends: the draft is inserted into the composer as ordinary text and the agent sends it with the composer's own button.

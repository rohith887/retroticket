# Legacy Python email scripts (deprecated)

These three scripts were moved here unchanged. **Do not run them.** They are kept only for reference.

| File | What it did |
|---|---|
| `email_worker.py` | Polled `emailmessages` for `priority: "pending"`, guessed a priority from keywords / TextBlob, and wrote it to the email **and directly to the ticket**. |
| `debug_emails.py` | Printed counts and samples of those `pending` emails. |
| `fix_emails.py` | Bulk-set `priority: "pending"` on emails. |

## Why they are deprecated

* They connected to a database named `peppermint`; the application uses `pp`, so they never saw real data.
* They relied on fields (`priority`, `sentiment_analyzed`, lock flags) that the Node `EmailMessage` schema does not define.
* They changed ticket priority directly in MongoDB, bypassing Node: no permissions, no activity log, no audit trail.
* TextBlob and pymongo were never installed or listed anywhere.

## What replaces them

`apps/intelligence` (FastAPI) returns sentiment, intent and a priority **suggestion** for a message, and the Node API
(`src/lib/services/ai.service.js`, `src/controllers/ai.js`) stores each result as an `AiInsight` and applies a suggestion
only when a signed-in user accepts it. Nothing in the new path writes to a ticket on its own.

Nothing in the application imports these files, and no process manager entry starts them, so removing this folder later is safe.

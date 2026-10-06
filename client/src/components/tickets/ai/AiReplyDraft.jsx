// "Draft reply" strip above the composer. It only prepares editable text: the draft is inserted into the composer and the
// agent reviews, edits and sends it with the composer's own button. Nothing is sent from here.
import React from "react";
import { Sparkles } from "lucide-react";
import { Alert, Badge, Button } from "../../../ui";
import { failureMessage, replyFailureMessage, replyRefusalMessage } from "./format";

const SOURCE_LABELS = { claim: "Customer said", verified_fact: "Ticket record", pattern: "Standard wording" };

function Why({ draft }) {
  return (
    <details className="text-caption text-ink-muted">
      <summary className="cursor-pointer select-none text-ink-muted hover:text-ink">Why this draft?</summary>
      <ul className="mt-1 space-y-1">
        {draft.sentences.map((sentence, index) => (
          <li key={index}>
            <Badge tone={sentence.source.type === "pattern" ? "neutral" : "brand"}>{SOURCE_LABELS[sentence.source.type] || sentence.source.type}</Badge> <span className="text-ink">{sentence.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AiReplyDraft({ state }) {
  if (!state.enabled) return null;
  const { draft, stale, outcome, isGenerating, waitingToReplace, isInserted } = state;
  const label = isGenerating ? "Generating…" : draft || outcome ? "Draft again" : "Draft reply";

  return (
    <div className="shrink-0 space-y-2 border-t border-line bg-canvas px-3 py-2" aria-label="Draft reply" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-caption text-ink-muted">
          {draft && !stale ? "Draft ready" : stale ? "Draft is out of date" : "Draft an editable reply from this conversation. Nothing is sent."}
        </span>
        <div className="flex items-center gap-2">
          {draft ? (
            <Button size="sm" variant="ghost" className="text-ink-muted" onClick={state.dismiss} disabled={isGenerating}>
              Dismiss
            </Button>
          ) : null}
          <Button size="sm" onClick={state.generate} loading={isGenerating} disabled={isGenerating}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {label}
          </Button>
        </div>
      </div>

      {outcome?.kind === "insufficient" ? <Alert tone="info" title="No safe draft available">{replyRefusalMessage(outcome.reason)} You can write the reply yourself.</Alert> : null}
      {outcome?.kind === "failed" ? (
        <Alert tone="warning" action={<Button size="sm" onClick={state.generate}>Retry</Button>}>
          {outcome.reason === "request_failed" ? "The draft request could not be completed." : replyFailureMessage(outcome.reason) || failureMessage(outcome.reason)} You can keep writing the reply yourself.
        </Alert>
      ) : null}

      {draft && stale ? <Alert tone="warning">The customer has written since this draft was made, so it may not answer their latest message. Draft again to update it.</Alert> : null}

      {draft && waitingToReplace ? (
        <Alert tone="info" title="Your reply already has text">
          <span className="mr-2">The draft was not inserted, so your text is safe.</span>
          <Button size="sm" onClick={state.replaceWithDraft}>Replace with draft</Button>{" "}
          <Button size="sm" variant="ghost" onClick={state.keepMyText}>Keep my text</Button>
        </Alert>
      ) : null}

      {draft && !stale && isInserted ? <p className="text-caption text-ink-muted">The draft is in the reply box. Read it and edit it before you send.</p> : null}
      {draft && (draft.warnings || []).length ? (
        <ul className="list-disc space-y-0.5 pl-4 text-caption text-warning-ink">
          {draft.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {draft ? <Why draft={draft} /> : null}
    </div>
  );
}

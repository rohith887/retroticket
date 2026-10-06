// "Summary" section of the AI panel. The summary is built by Node's internal engine from facts (see AI_INTEGRATION.md): every
// sentence is a fixed template, customer statements read as claims, and lines that rest on wording still under review say so.
// Generating it shows text only; it never changes the ticket and never sends anything.
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Alert, Badge, Button, Skeleton } from "../../../ui";
import { timeAgo } from "../../../ui/time";
import { aiSummaryKey, fetchSummary, generateSummary } from "./api";
import { failureMessage } from "./format";

const SECTIONS = [
  ["request", "Request"],
  ["claim", "What the customer says"],
  ["verified", "Recorded on the ticket"],
  ["state", "Where it stands"],
];
const PENDING_LABELS = {
  unanswered_question: "Unanswered question",
  information_requested: "Information requested from the customer",
  support_commitment: "Support said it would follow up",
  unanswered_request: "Unanswered request",
};

export function AiSummary({ ticketId, fetchWithAuth }) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState(null);
  const query = useQuery({ queryKey: aiSummaryKey(ticketId), queryFn: () => fetchSummary(fetchWithAuth, ticketId), retry: false });
  const generate = useMutation({
    mutationFn: () => generateSummary(fetchWithAuth, ticketId),
    onMutate: () => setFailure(null),
    onSuccess: (result) => {
      if (result.ok) queryClient.setQueryData(aiSummaryKey(ticketId), result.insight);
      else setFailure(result.reason);
    },
    onError: () => setFailure("request_failed"),
  });

  const insight = query.data;
  const summary = insight?.summary;
  const warnings = insight?.warnings || [];
  const pending = summary?.pending || [];

  return (
    <section className="border-b border-line px-4 py-3" aria-label="Conversation summary">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-caption font-medium uppercase tracking-wide text-ink-faint">Summary</h3>
        <Button size="sm" onClick={() => generate.mutate()} loading={generate.isPending} disabled={generate.isPending}>
          <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {generate.isPending ? "Summarizing…" : insight ? (insight.stale ? "Update summary" : "Refresh") : "Summarize"}
        </Button>
      </div>

      <div className="space-y-3" aria-live="polite">
        {failure ? (
          <Alert tone="warning">
            {failure === "request_failed" ? "The summary request could not be completed." : failureMessage(failure)} You can keep working on this ticket as usual.
          </Alert>
        ) : null}

        {generate.isPending && !insight ? (
          <div className="space-y-2" aria-label="Summarizing" aria-busy="true">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : null}

        {query.isError ? <p className="text-caption text-ink-faint">An earlier summary could not be loaded.</p> : null}

        {!insight && !generate.isPending && !failure && !query.isPending ? (
          <p className="text-caption text-ink-faint">Summarize this conversation from the facts in it. Customer statements are shown as claims, not as verified facts.</p>
        ) : null}

        {insight ? (
          <div className="space-y-3">
            {insight.stale ? <Badge tone="warning">Out of date: the ticket has newer messages</Badge> : null}
            {SECTIONS.map(([section, title]) => {
              const lines = summary.lines.filter((line) => line.section === section);
              if (!lines.length) return null;
              return (
                <div key={section} className="space-y-1">
                  <div className="text-caption text-ink-faint">{title}</div>
                  <ul className="space-y-1">
                    {lines.map((line, index) => (
                      <li key={`${section}-${index}`} className="text-body-sm text-ink">
                        {line.text}
                        {line.review === "needs_review" ? (
                          <span className="ml-1.5 align-middle">
                            <Badge tone="warning">Under review</Badge>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {pending.length ? (
              <div className="space-y-1">
                <div className="text-caption text-ink-faint">Open items</div>
                <ul className="list-disc space-y-0.5 pl-4 text-caption text-ink-muted">
                  {[...new Set(pending.map((p) => p.kind))].map((kind) => (
                    <li key={kind}>{PENDING_LABELS[kind] || kind}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {warnings.length ? (
              <ul className="list-disc space-y-0.5 pl-4 text-caption text-warning-ink">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <p className="text-caption text-ink-faint">Built from fixed templates over extracted facts, not written by a language model. {insight.createdAt ? `Generated ${timeAgo(insight.createdAt)}.` : ""}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

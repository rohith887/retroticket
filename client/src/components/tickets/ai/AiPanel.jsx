// "AI analysis" section of the ticket properties panel.
//
// React -> Node only (/v1/ai/*). Analysing shows suggestions; it never changes the ticket. The ticket priority changes only
// when the agent presses Accept, through Node's accept endpoint, and the ticket is then re-read from the server.
// If AI is off, down or slow this section reports it and nothing else on the ticket is affected.
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useUser } from "../../../store/session";
import { usePermissions } from "../../../store/permissions";
import { Alert, Badge, Button, Skeleton, cn, toast } from "../../../ui";
import { timeAgo } from "../../../ui/time";
import { TICKET_LISTS_KEY, priorityMeta, ticketKey } from "../model";
import { AiApiError, acceptInsight, aiInsightsKey, aiStatusKey, analyzeTicket, dismissInsight, fetchAiStatus, fetchInsights } from "./api";
import { AiSummary } from "./AiSummary";
import { CONFIDENCE_NOTE, appliedText, failureMessage, intentLabel, percent, sentimentMeta } from "./format";

const priorityLabel = (value) => priorityMeta(value).label;

function Confidence({ insight }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-caption text-ink-muted" title={CONFIDENCE_NOTE}>
        {percent(insight.confidence)} confidence
      </span>
      {insight.lowConfidence ? <Badge tone="warning">Low confidence</Badge> : null}
    </span>
  );
}

function ReviewLine({ insight, extra }) {
  if (insight.status === "suggested") return null;
  const verb = insight.status === "accepted" ? "Accepted" : "Dismissed";
  return (
    <p className="text-caption text-ink-muted">
      {verb}
      {insight.reviewedBy?.name ? ` by ${insight.reviewedBy.name}` : ""}
      {insight.reviewedAt ? ` · ${timeAgo(insight.reviewedAt)}` : ""}
      {extra ? ` · ${extra}` : ""}
    </p>
  );
}

function Row({ title, insight, children, actions }) {
  const dismissed = insight.status === "dismissed";
  return (
    <div className={cn("space-y-1", dismissed && "opacity-60")}>
      <div className="text-caption text-ink-faint">{title}</div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{children}</div>
      {actions}
      <ReviewLine insight={insight} extra={insight.type === "priority" ? appliedText(insight, priorityLabel) : null} />
    </div>
  );
}

export function AiPanel({ ticket }) {
  const { fetchWithAuth } = useUser();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const ticketId = ticket._id;
  const [failure, setFailure] = useState(null);

  const status = useQuery({ queryKey: aiStatusKey, queryFn: () => fetchAiStatus(fetchWithAuth), staleTime: 60_000, retry: false });
  const enabled = status.data?.enabled === true;
  const insightsQuery = useQuery({ queryKey: aiInsightsKey(ticketId), queryFn: () => fetchInsights(fetchWithAuth, ticketId), enabled, retry: false });

  const analyze = useMutation({
    mutationFn: () => analyzeTicket(fetchWithAuth, ticketId),
    onMutate: () => setFailure(null),
    onSuccess: (result) => {
      if (result.ok) queryClient.setQueryData(aiInsightsKey(ticketId), result.insights);
      else setFailure(result.reason);
    },
    onError: () => setFailure("request_failed"),
  });

  const review = useMutation({
    mutationFn: ({ insight, action }) => (action === "accept" ? acceptInsight(fetchWithAuth, insight._id) : dismissInsight(fetchWithAuth, insight._id)),
    onSuccess: (updated, { action }) => {
      if (action === "accept" && updated.type === "priority") {
        toast.success(updated.applied?.priority?.unchanged ? `Priority is already ${priorityLabel(updated.applied.priority.to)}` : `Priority set to ${priorityLabel(updated.label)}`);
        // The ticket's real priority comes from the server, not from the suggestion.
        queryClient.invalidateQueries({ queryKey: ticketKey(ticketId) });
        queryClient.invalidateQueries({ queryKey: TICKET_LISTS_KEY });
      } else {
        toast.success(action === "accept" ? "Marked as reviewed" : "Suggestion dismissed");
      }
      queryClient.invalidateQueries({ queryKey: aiInsightsKey(ticketId) });
    },
    onError: (error) => {
      if (error instanceof AiApiError && error.status === 409) toast.info("This suggestion was already reviewed.");
      else toast.error("Could not save your decision. Nothing was changed.");
      queryClient.invalidateQueries({ queryKey: aiInsightsKey(ticketId) });
    },
  });

  // Not configured (or not visible to this role): the section does not exist.
  if (status.isPending || status.isError || !enabled) return null;

  const insights = insightsQuery.data || [];
  const byType = Object.fromEntries(insights.map((i) => [i.type, i]));
  const sentiment = byType.sentiment;
  const intent = byType.intent;
  const priority = byType.priority;
  const canReview = can("issue::update");
  const busyId = review.isPending ? review.variables?.insight._id : null;

  const reviewButtons = (insight, { accept }) =>
    insight.status === "suggested" && canReview ? (
      <div className="flex gap-2 pt-0.5">
        {accept ? (
          <Button size="sm" variant="primary" loading={busyId === insight._id && review.variables?.action === "accept"} disabled={Boolean(busyId)} onClick={() => review.mutate({ insight, action: "accept" })}>
            Accept
          </Button>
        ) : null}
        <Button size="sm" variant={accept ? "secondary" : "ghost"} className={accept ? undefined : "-ml-2 text-ink-muted"} loading={busyId === insight._id && review.variables?.action === "dismiss"} disabled={Boolean(busyId)} onClick={() => review.mutate({ insight, action: "dismiss" })}>
          Dismiss
        </Button>
      </div>
    ) : null;

  return (
    <>
      <AiSummary ticketId={ticketId} fetchWithAuth={fetchWithAuth} />
    <section className="border-b border-line px-4 py-3" aria-label="AI analysis">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-caption font-medium uppercase tracking-wide text-ink-faint">AI analysis</h3>
        <Button size="sm" onClick={() => analyze.mutate()} loading={analyze.isPending} disabled={analyze.isPending}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {analyze.isPending ? "Analyzing…" : insights.length ? "Re-analyze" : "Analyze"}
        </Button>
      </div>

      <div className="space-y-3" aria-live="polite">
        {failure ? (
          <Alert tone="warning">
            {failure === "request_failed" ? "The analysis request could not be completed." : failureMessage(failure)} You can keep working on this ticket as usual.
          </Alert>
        ) : null}

        {!failure && status.data.available === false && insights.length === 0 ? (
          <p className="text-caption text-ink-faint">The analysis service looks offline. You can still try it, and everything else keeps working.</p>
        ) : null}

        {analyze.isPending && insights.length === 0 ? (
          <div className="space-y-2" aria-label="Analyzing" aria-busy="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : null}

        {insightsQuery.isError ? <p className="text-caption text-ink-faint">Earlier results could not be loaded.</p> : null}

        {insights.length === 0 && !analyze.isPending && !failure && !insightsQuery.isPending ? (
          <p className="text-caption text-ink-faint">Analyze the latest customer message to see sentiment, intent and a priority suggestion. Nothing changes until you accept it.</p>
        ) : null}

        {sentiment ? (
          <Row title="Sentiment" insight={sentiment} actions={reviewButtons(sentiment, { accept: false })}>
            <Badge tone={sentimentMeta(sentiment.label).tone}>{sentimentMeta(sentiment.label).label}</Badge>
            <Confidence insight={sentiment} />
          </Row>
        ) : null}

        {intent ? (
          <Row title="Intent" insight={intent} actions={reviewButtons(intent, { accept: false })}>
            <span className="text-body-sm font-medium text-ink">{intentLabel(intent.label)}</span>
            <Confidence insight={intent} />
          </Row>
        ) : null}

        {priority ? (
          <Row title="Suggested priority" insight={priority} actions={reviewButtons(priority, { accept: true })}>
            <Badge tone={priorityMeta(priority.label).tone}>{priorityLabel(priority.label)}</Badge>
            <Confidence insight={priority} />
            <p className="w-full text-caption text-ink-muted">
              {priority.label === ticket.priority ? "Same as the current priority." : `Current priority: ${priorityLabel(ticket.priority)}.`}
            </p>
            {priority.lowConfidence && priority.status === "suggested" ? <p className="w-full text-caption text-warning-ink">Weak signal. Check the conversation before accepting.</p> : null}
            {priority.reasons?.length ? (
              <ul className="w-full list-disc space-y-0.5 pl-4 text-caption text-ink-muted">
                {priority.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </Row>
        ) : null}

        {insights.length > 0 ? <p className="text-caption text-ink-faint">{CONFIDENCE_NOTE}</p> : null}
      </div>
    </section>
    </>
  );
}

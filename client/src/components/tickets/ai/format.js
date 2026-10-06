// Display helpers for AI insights. Presentation only: nothing here decides anything about a ticket.

export const CONFIDENCE_NOTE = "Confidence is the current analysis provider's match strength, not a guaranteed probability.";

const humanize = (value) => String(value || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const sentimentMeta = (label) =>
  ({
    positive: { label: "Positive", tone: "success" },
    neutral: { label: "Neutral", tone: "neutral" },
    negative: { label: "Negative", tone: "warning" },
    frustrated: { label: "Frustrated", tone: "danger" },
  })[label] || { label: humanize(label), tone: "neutral" };

export const intentLabel = (label) => humanize(label);

export const percent = (confidence) => `${Math.round(Number(confidence) * 100)}%`;

/** What to tell the agent when an analysis could not be produced. Always ends with "you can keep working" reassurance in the panel. */
export function failureMessage(reason) {
  switch (reason) {
    case "disabled":
      return "AI analysis is not turned on.";
    case "unauthorized":
      return "The analysis service rejected its credentials. Ask an administrator to check the AI settings.";
    case "rate_limited":
      return "Too many analysis requests. Try again in a minute.";
    case "timeout":
      return "The analysis took too long.";
    case "invalid_response":
    case "invalid_request":
    case "empty_text":
    case "empty_result":
    case "internal_error":
      return "The analysis did not return a usable result.";
    case "unavailable":
    case "circuit_open":
    case "provider_error":
    default:
      return "Analysis is not available right now.";
  }
}

/** One line describing what accepting a priority insight did. */
export function appliedText(insight, priorityLabel) {
  const change = insight.applied?.priority;
  if (!change) return null;
  if (change.unchanged) return `Priority was already ${priorityLabel(change.to)}`;
  return `Priority changed from ${priorityLabel(change.from)} to ${priorityLabel(change.to)}`;
}

/** Why no draft was produced: the engine refused rather than guess. */
export function replyRefusalMessage(reason) {
  switch (reason) {
    case "no_customer_message":
      return "There is no customer message to reply to.";
    case "ambiguous_state":
      return "It is not clear that the customer is waiting for a reply.";
    case "unknown_intent":
      return "The request could not be understood well enough.";
    case "unsupported_request":
      return "This kind of request is not covered by the available reply wording.";
    case "missing_entity":
      return "It is not clear which document or verification this is about.";
    default:
      return "There is not enough information to write a safe reply.";
  }
}

/** Failures specific to drafting (the generic ones use failureMessage). */
export function replyFailureMessage(reason) {
  if (reason === "validation_failed") return "The draft did not pass the safety checks, so it was not used.";
  if (reason === "stale_context") return "The conversation changed while drafting. Try again.";
  return null;
}

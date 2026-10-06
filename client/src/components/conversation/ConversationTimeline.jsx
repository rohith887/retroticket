// Shared conversation UI (used by Tickets and Threads): MessageBubble + ConversationTimeline.
//
// A message is normalised to:
//   { id, direction: "inbound" | "outbound" | "internal", senderName, body, createdAt, failed?: boolean }
// inbound = from the customer (left), outbound = from your team to the customer (right), internal = private note.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Lock, MessageSquare } from "lucide-react";
import { Badge, EmptyState, cn, focusRing } from "../../ui";
import { formatDateTime } from "../../ui/time";

/** Split an email body into normal text and quoted ("> ...") blocks. */
export function splitBody(body) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  for (const line of lines) {
    const quoted = /^\s*>/.test(line);
    const last = blocks[blocks.length - 1];
    const text = quoted ? line.replace(/^\s*>+\s?/, "") : line;
    if (last && last.quoted === quoted) last.lines.push(text);
    else blocks.push({ quoted, lines: [text] });
  }
  return blocks.map((b) => ({ quoted: b.quoted, text: b.lines.join("\n").trim() })).filter((b) => b.text);
}

const dayLabel = (value) => {
  const date = new Date(value);
  if (date.toDateString() === new Date().toDateString()) return "Today";
  if (date.toDateString() === new Date(Date.now() - 86400000).toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const timeOnly = (value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Body({ text, tone }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const blocks = useMemo(() => splitBody(text), [text]);
  const quoted = blocks.filter((b) => b.quoted);
  return (
    <div className={cn("space-y-2 break-words text-body-sm", tone)}>
      {blocks.filter((b) => !b.quoted).map((b, i) => (
        <p key={i} className="whitespace-pre-wrap">{b.text}</p>
      ))}
      {quoted.length > 0 ? (
        <div>
          <button type="button" onClick={() => setShowQuoted((v) => !v)} aria-expanded={showQuoted} className={cn("rounded-ds-sm text-caption font-medium opacity-75 underline-offset-2 hover:underline", focusRing)}>
            {showQuoted ? "Hide quoted text" : "Show quoted text"}
          </button>
          {showQuoted ? <p className="mt-1 whitespace-pre-wrap border-l-2 border-current pl-3 text-caption opacity-75">{quoted.map((b) => b.text).join("\n\n")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function DeliveryNote({ delivery, onRetry, outbound }) {
  if (!delivery || delivery.status === "sent") return null;
  const map = {
    queued: { text: "Sending…", tone: "text-ink-faint" },
    processing: { text: delivery.lastError ? "Retrying…" : "Sending…", tone: "text-ink-faint" },
    canceled: { text: "Not sent (undone)", tone: "text-ink-faint" },
    failed: { text: "Email could not be delivered", tone: "text-danger-ink" },
  };
  const info = map[delivery.status];
  if (!info) return null;
  return (
    <div className={cn("mt-1 flex items-center gap-2 text-caption", info.tone, outbound && "justify-end")} role={delivery.status === "failed" ? "alert" : undefined}>
      <span>{info.text}</span>
      {delivery.status === "failed" && onRetry ? (
        <button type="button" onClick={onRetry} className={cn("rounded-ds-sm font-semibold underline", focusRing)}>Retry</button>
      ) : null}
    </div>
  );
}

/** A system event in the flow of the conversation: small, centred, quiet. */
function EventLine({ event }) {
  return (
    <li className={cn("flex items-center justify-center gap-2 py-0.5 text-caption", event.tone === "danger" ? "text-danger-ink" : "text-ink-faint")}>
      <span className="h-1 w-1 rounded-full bg-current opacity-60" aria-hidden="true" />
      <span className="text-center">{event.text}</span>
      {event.createdAt ? <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>{timeOnly(event.createdAt)}</time> : null}
    </li>
  );
}

export const MessageBubble = React.memo(function MessageBubble({ message, onRetry }) {
  const internal = message.direction === "internal";
  const outbound = message.direction === "outbound";
  return (
    <li className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
      <div className={cn("mb-1 flex items-center gap-2 text-caption text-ink-muted", outbound && "flex-row-reverse")}>
        <span className="font-medium text-ink">{message.senderName || "Unknown sender"}</span>
        {internal ? <Badge tone="warning"><Lock className="h-3 w-3" aria-hidden="true" /> Internal note</Badge> : null}
        {message.failed ? <Badge tone="danger">Failed to send</Badge> : null}
        {message.createdAt ? <time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{timeOnly(message.createdAt)}</time> : null}
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-ds-lg border px-3 py-2",
          internal ? "border-transparent bg-warning-soft" : outbound ? "border-brand-softline bg-brand-soft" : "border-line bg-subtle"
        )}
      >
        <Body text={message.body} tone={internal ? "text-warning-ink" : outbound ? "text-brand-ink" : "text-ink"} />
      </div>
      <DeliveryNote delivery={message.delivery} outbound={outbound} onRetry={onRetry ? () => onRetry(message) : undefined} />
    </li>
  );
});

export function ConversationTimeline({ messages, onRetry, emptyTitle = "No messages yet", emptyDescription = "Messages will appear here." }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return <EmptyState icon={MessageSquare} title={emptyTitle} description={emptyDescription} className="py-10" />;
  }
  let lastDay = null;
  return (
    <ol className="space-y-3 px-4 py-4" aria-label="Conversation">
      {messages.map((message) => {
        const day = message.createdAt ? new Date(message.createdAt).toDateString() : null;
        const divider = day && day !== lastDay;
        if (day) lastDay = day;
        return (
          <React.Fragment key={message.id}>
            {divider ? (
              <li className="flex items-center gap-3 py-1 text-caption text-ink-faint" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                {dayLabel(message.createdAt)}
                <span className="h-px flex-1 bg-line" />
              </li>
            ) : null}
            {message.kind === "event" ? <EventLine event={message} /> : <MessageBubble message={message} onRetry={onRetry} />}
          </React.Fragment>
        );
      })}
      <li ref={endRef} aria-hidden="true" />
    </ol>
  );
}

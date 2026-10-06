import React from "react";
import { Badge, cn, focusRing } from "../../ui";
import { timeAgo } from "../../ui/time";
import { statusMeta, threadTitle } from "./model";

/** One inbox row. The whole row is the button: click or Enter opens the conversation. */
export const ThreadRow = React.memo(function ThreadRow({ thread, mailboxName, selected, onOpen }) {
  const unread = (thread.unreadCount || 0) > 0;
  const status = statusMeta(thread.status);
  const secondary = [thread.sourceCaseId, mailboxName].filter(Boolean).join(" · ");

  return (
    <li>
      <button
        type="button"
        data-thread-row
        aria-current={selected ? "true" : undefined}
        onClick={() => onOpen(thread._id)}
        className={cn(
          "group relative flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors",
          selected ? "bg-brand-soft" : "hover:bg-subtle",
          focusRing,
          "focus-visible:ring-inset"
        )}
      >
        {selected ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-brand" /> : null}
        <span className="mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center">
          {unread ? <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-body-sm text-ink", unread ? "font-semibold" : "font-medium")}>{threadTitle(thread)}</span>
            <time className={cn("shrink-0 text-caption", unread ? "font-medium text-ink" : "text-ink-faint")} dateTime={thread.lastMessageAt || undefined}>
              {thread.lastMessageAt ? timeAgo(thread.lastMessageAt) : ""}
            </time>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-caption text-ink-muted">{secondary}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
          <span className={cn("mt-1 block truncate text-body-sm", unread ? "text-ink-muted" : "text-ink-faint")}>
            {thread.lastMessage || "No messages yet"}
          </span>
          {unread ? <span className="sr-only">{thread.unreadCount} unread</span> : null}
        </span>
      </button>
    </li>
  );
});

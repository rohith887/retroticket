import React from "react";
import { Link } from "react-router-dom";
import { Avatar, Badge, Tooltip, cn, focusRing } from "../../ui";
import { timeAgo } from "../../ui/time";
import { assigneeOf, clientNameOf, priorityMeta, requesterOf, ticketState } from "./model";

const preview = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);

/** One inbox row. The whole row is a link, so click, Enter and middle-click all open the ticket. */
export const TicketRow = React.memo(function TicketRow({ ticket, to }) {
  const unread = (ticket.unreadCount || 0) > 0;
  const state = ticketState(ticket);
  const priority = priorityMeta(ticket.priority);
  const assignee = assigneeOf(ticket);
  const client = clientNameOf(ticket);
  const reference = [ticket.number ? `#${ticket.number}` : null, ticket.sourceCaseId, client].filter(Boolean).join(" · ");

  return (
    <li>
      <Link
        to={to}
        data-ticket-row
        className={cn("group flex items-start gap-3 border-b border-line px-4 py-3 transition-colors hover:bg-subtle", focusRing, "focus-visible:ring-inset")}
      >
        <Avatar name={requesterOf(ticket)} size="md" className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-body-sm text-ink", unread ? "font-bold" : "font-semibold")}>
              {unread ? <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand align-middle" aria-hidden="true" /> : null}
              {requesterOf(ticket)}
              {unread ? <span className="sr-only"> ({ticket.unreadCount} unread)</span> : null}
            </span>
            <time className={cn("shrink-0 text-caption", unread ? "font-medium text-ink" : "text-ink-faint")} dateTime={ticket.lastMessageAt || ticket.updatedAt || ticket.createdAt}>{timeAgo(ticket.lastMessageAt || ticket.updatedAt || ticket.createdAt, "")}</time>
          </span>
          <span className="block truncate text-body-sm text-ink">{ticket.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-caption text-ink-muted">{reference}</span>
            <Badge tone={priority.tone}>{priority.label}</Badge>
            <Badge tone={state.tone} dot>{state.label}</Badge>
          </span>
          {ticket.lastMessage || ticket.detail ? <span className={cn("mt-1 block truncate text-body-sm", unread ? "text-ink-muted" : "text-ink-faint")}>{preview(ticket.lastMessage || ticket.detail)}</span> : null}
        </span>
        <span className="mt-0.5 shrink-0">
          {assignee ? (
            <Tooltip content={`Assigned to ${assignee.name}`} side="left">
              <span><Avatar name={assignee.name} size="sm" /></span>
            </Tooltip>
          ) : (
            <span className="text-caption text-ink-faint">Unassigned</span>
          )}
        </span>
      </Link>
    </li>
  );
});

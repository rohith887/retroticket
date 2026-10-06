// Ticket workspace at /agents/tickets/:id: header, conversation + composer, properties panel.
// Wide screens: conversation | properties. Small screens: conversation full width, properties in a drawer.
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, PanelRight, RotateCcw } from "lucide-react";
import { useUser } from "../../store/session";
import { usePermissions } from "../../store/permissions";
import { Alert, Avatar, Badge, Button, Drawer, DrawerContent, EmptyState, Skeleton } from "../../ui";
import { ConversationHeader } from "../conversation/ConversationHeader";
import { ConversationTimeline } from "../conversation/ConversationTimeline";
import { MessageComposer } from "../conversation/MessageComposer";
import { AiReplyDraft } from "./ai/AiReplyDraft";
import { useReplyDraft } from "./ai/useReplyDraft";
import { useBase } from "./useTicketBase";
import { TicketProperties } from "./TicketProperties";
import { useTicketActions } from "./useTicketActions";
import { TICKET_LISTS_KEY, assigneeOf, buildMessages, fetchTicket, hasPendingDelivery, priorityMeta, ticketKey, ticketState } from "./model";

function inboxLink(base) {
  try {
    return `${base}/tickets?status=${sessionStorage.getItem("agentInboxView") || "mine"}`;
  } catch {
    return `${base}/tickets?status=mine`;
  }
}

export default function TicketWorkspace() {
  const { id } = useParams();
  const base = useBase();
  const navigate = useNavigate();
  const { fetchWithAuth, user } = useUser();
  const { can } = usePermissions();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showActivity, setShowActivity] = useState(() => {
    try {
      return localStorage.getItem("ticketShowActivity") !== "0";
    } catch {
      return true;
    }
  });
  const toggleActivity = () =>
    setShowActivity((value) => {
      try {
        localStorage.setItem("ticketShowActivity", value ? "0" : "1");
      } catch {
        /* preference just will not persist */
      }
      return !value;
    });

  const query = useQuery({ queryKey: ticketKey(id), queryFn: () => fetchTicket(fetchWithAuth, id), staleTime: 15_000,
    // While a reply is waiting to be emailed, poll briefly so Sending turns into Sent (or Failed).
    refetchInterval: (q) => (hasPendingDelivery(q.state.data) ? 3000 : false),
  });
  const queryClient = useQueryClient();
  const actions = useTicketActions(id);
  // Opening a ticket marks it read on the server; refresh the inbox so its unread dot clears.
  useEffect(() => {
    if (query.isSuccess) queryClient.invalidateQueries({ queryKey: TICKET_LISTS_KEY });
  }, [query.isSuccess, id, queryClient]);
  const ticket = query.data;
  const messages = useMemo(() => (ticket ? buildMessages(ticket, user, { activity: showActivity }) : []), [ticket, user, showActivity]);

  // AI reply drafts: the draft goes into the composer as ordinary editable text; the agent still sends it.
  const [composerText, setComposerText] = useState("");
  const [seed, setSeed] = useState(null);
  const insertIntoComposer = (text) => setSeed((prev) => ({ key: (prev?.key || 0) + 1, text }));
  const replyDraft = useReplyDraft({ ticketId: id, version: messages.length, composerText, insertIntoComposer });

  if (query.isPending) {
    return (
      <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading ticket">
        <div className="space-y-2 border-b border-line px-4 py-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-2/3" />
        </div>
        <div className="flex-1 space-y-4 p-4">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="ml-auto h-16 w-2/3" />
        </div>
      </div>
    );
  }
  if (query.isError || !ticket) {
    return (
      <div className="mx-auto max-w-xl p-6">
        {/not found/i.test(query.error?.message || "") ? (
          <EmptyState title="Ticket not found" description="It may have been deleted, or the link is wrong." action={<Button onClick={() => navigate(inboxLink(base))}>Back to inbox</Button>} />
        ) : (
          <Alert tone="danger" title="Couldn't load this ticket" action={<Button size="sm" onClick={() => query.refetch()}>Retry</Button>}>{query.error?.message}</Alert>
        )}
      </div>
    );
  }

  const state = ticketState(ticket);
  const priority = priorityMeta(ticket.priority);
  const assignee = assigneeOf(ticket);
  const canUpdate = can("issue::update");
  const canComment = can("issue::comment");

  async function submit({ mode, body }) {
    await actions.comment(body, mode === "reply");
    if (mode === "reply") replyDraft.onSent(body);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ConversationHeader
        backTo={inboxLink(base)}
        backLabel="Inbox"
        reference={ticket.number ? `#${ticket.number}` : undefined}
        title={ticket.title}
        badges={
          <>
            <Badge tone={state.tone} dot>{state.label}</Badge>
            <Badge tone={priority.tone}>{priority.label}</Badge>
            {assignee ? (
              <span className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted"><Avatar name={assignee.name} size="xs" /> {assignee.name}</span>
            ) : (
              <span className="text-body-sm text-ink-faint">Unassigned</span>
            )}
          </>
        }
        actions={
          <>
            {canUpdate ? (
              <Button size="sm" onClick={() => actions.setComplete(!ticket.isComplete).catch(() => {})} className="hidden sm:inline-flex">
                {ticket.isComplete ? <><RotateCcw className="h-3.5 w-3.5" /> Reopen</> : <><CheckCheck className="h-3.5 w-3.5" /> Resolve</>}
              </Button>
            ) : null}
            <Button size="sm" icon aria-label="Ticket details" className="lg:hidden" onClick={() => setDetailsOpen(true)}>
              <PanelRight className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 justify-end px-4 pt-2">
            <button type="button" onClick={toggleActivity} aria-pressed={showActivity} className="rounded-ds-sm text-caption font-medium text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {showActivity ? "Hide activity" : "Show activity"}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite">
            <ConversationTimeline messages={messages} onRetry={(m) => actions.retry(m.id)} emptyTitle="No messages yet" emptyDescription="This ticket has no description or replies yet." />
          </div>
          {canComment ? <AiReplyDraft state={replyDraft} /> : null}
          {canComment ? (
            <MessageComposer
              onSubmit={submit}
              seed={seed}
              onTextChange={setComposerText}
              reply={{ label: ticket.email ? `To ${ticket.email}` : "No email on file: saved to the ticket only" }}
              internal={{ enabled: true, hint: "Only visible to your team" }}
            />
          ) : (
            <p className="border-t border-line px-4 py-3 text-body-sm text-ink-muted">Your role can read this ticket but not reply to it.</p>
          )}
        </div>

        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-line bg-canvas lg:block" aria-label="Ticket properties">
          <TicketProperties ticket={ticket} actions={actions} />
        </aside>
      </div>

      <Drawer open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DrawerContent title="Ticket details" description={ticket.title}>
          <TicketProperties ticket={ticket} actions={actions} />
        </DrawerContent>
      </Drawer>
    </div>
  );
}

// The conversation for one thread: header, key details, message timeline and composer.
// Rendered inline (wide screens) or inside a full-screen Drawer (small screens) by ThreadsWorkspace.
import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getThreadFull, sendMessage } from "../../services/communication.service";
import { useUser } from "../../store/session";
import { Alert, Avatar, Badge, Button, Skeleton, toast } from "../../ui";
import { formatDateTime, timeAgo } from "../../ui/time";
import { ConversationTimeline } from "../conversation/ConversationTimeline";
import { MessageComposer } from "../conversation/MessageComposer";
import { CHANNEL_LABELS, THREADS_KEY, defaultInternalUserId, replyRecipient, senderName, statusMeta, threadTitle } from "./model";

const toMessage = (m) => ({
  id: m._id,
  direction: m.direction,
  senderName: senderName(m),
  body: m.body,
  createdAt: m.createdAt,
  failed: m.status === "failed",
});

function ThreadComposer({ thread, workflow, onSent }) {
  const { fetchWithAuth, user } = useUser();
  const recipient = replyRecipient(thread, workflow);
  const internalUserId = defaultInternalUserId(thread);

  async function submit({ mode, body, email }) {
    const list = (value) => String(value || "").split(",").map((v) => v.trim()).filter(Boolean);
    const to = mode === "reply" ? list(recipient || email) : list(email);
    try {
      await sendMessage(fetchWithAuth, {
        threadId: thread._id,
        body,
        direction: mode === "internal" ? "internal" : "outbound",
        channel: "email",
        recipients: to.length ? { to, cc: [], bcc: [] } : undefined,
        recipientUserId: mode === "internal" ? internalUserId || undefined : undefined,
        recipientEmail: mode === "reply" ? email || undefined : undefined,
        sender: { id: user?._id || null, name: user?.name || user?.email || "User", email: user?.email || null, type: user?._id ? "user" : "external" },
      });
    } catch (error) {
      toast.error(error.message || "Failed to send message");
      throw error;
    }
    toast.success(mode === "internal" ? "Internal note sent" : "Reply sent");
    onSent();
  }

  return (
    <MessageComposer
      onSubmit={submit}
      reply={{ to: recipient, askEmail: !recipient }}
      internal={{ enabled: Boolean(user?.isAgent || user?.isAdmin), askEmail: !internalUserId, hint: "Sent to the assigned validator, not the customer" }}
    />
  );
}

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-ink-faint">{label}</dt>
      <dd className="truncate text-body-sm text-ink" title={typeof children === "string" ? children : undefined}>{children || "—"}</dd>
    </div>
  );
}

export function ThreadPanel({ threadId, basePath, onBack, mailboxName }) {
  const { fetchWithAuth } = useUser();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => getThreadFull(fetchWithAuth, threadId),
    enabled: Boolean(threadId),
  });

  // Opening a thread marks it read on the server; refresh the list so the unread dot clears.
  useEffect(() => {
    if (query.isSuccess) queryClient.invalidateQueries({ queryKey: THREADS_KEY });
  }, [query.isSuccess, threadId, queryClient]);

  if (query.isPending) {
    return (
      <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading conversation">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-6 h-16 w-3/4" />
        <Skeleton className="ml-auto h-16 w-3/4" />
      </div>
    );
  }
  if (query.isError || !query.data?.thread) {
    return (
      <div className="p-4">
        <Alert tone="danger" action={<Button size="sm" onClick={() => query.refetch()}>Retry</Button>}>
          {query.error?.message || "This thread could not be found."}
        </Alert>
      </div>
    );
  }

  const { thread, messages, workflow } = query.data;
  const status = statusMeta(thread.status);
  const assignee = thread.claimedBy?.name || thread.workflowSnapshot?.currentUserName || workflow?.ownerSummary?.validator?.name || null;
  const mailbox = thread.mailboxId?.name || mailboxName || null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-start gap-2">
          {onBack ? (
            <Button variant="ghost" size="sm" icon aria-label="Back to threads" onClick={onBack} className="-ml-2 xl:hidden">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title font-semibold text-ink">{threadTitle(thread)}</h2>
            <p className="truncate text-body-sm text-ink-muted">{thread.sourceCaseId}</p>
          </div>
          <Button as={Link} to={`${basePath}/messages?threadId=${thread._id}`} variant="ghost" size="sm">
            <ExternalLink className="h-3.5 w-3.5" /> Open full view
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={status.tone} dot>{status.label}</Badge>
          {assignee ? (
            <span className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted">
              <Avatar name={assignee} size="xs" /> {assignee}
            </span>
          ) : (
            <span className="text-body-sm text-ink-faint">Unassigned</span>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <Fact label="Contact">{thread.applicantEmail || workflow?.candidateEmail}</Fact>
          <Fact label="Mailbox">{mailbox}</Fact>
          <Fact label="Channel">{CHANNEL_LABELS[thread.channel] || thread.channel}</Fact>
          <Fact label="Created">{formatDateTime(thread.createdAt)}</Fact>
          <Fact label="Last activity">{thread.lastMessageAt ? timeAgo(thread.lastMessageAt) : "No activity"}</Fact>
          <Fact label="Stage">{workflow?.currentStage || thread.currentStage}</Fact>
        </dl>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite">
        <ConversationTimeline messages={messages.map(toMessage)} emptyTitle="No messages yet" emptyDescription="Messages on this thread will appear here." />
      </div>

      <ThreadComposer thread={thread} workflow={workflow} onSent={() => { query.refetch(); queryClient.invalidateQueries({ queryKey: THREADS_KEY }); }} />
    </div>
  );
}

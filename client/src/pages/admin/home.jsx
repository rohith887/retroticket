// Admin Overview: what needs attention, service health, recent activity and setup progress.
import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, Clock, Inbox, Mail, UserX } from "lucide-react";
import { useUser } from "../../store/session";
import { Badge, Button, EmptyState, Page, PageHeader, Panel, PanelHeader, Skeleton, StatTile, cn, focusRing } from "../../ui";
import { timeAgo } from "../../ui/time";
import { useAdminSummary } from "../../ui/shell/AppShell";
import { fetchRoles, fetchUsers, ROLES_KEY, USERS_KEY } from "./users/api";

/* ------------------------------ data hooks ------------------------------ */

function useJson(key, path, options = {}) {
  const { fetchWithAuth } = useUser();
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await fetchWithAuth(path);
      if (!res.ok) throw new Error(`${path} failed (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
    ...options,
  });
}

/* ------------------------------ small parts ----------------------------- */

function PanelState({ loading, error, empty, emptyIcon, emptyTitle, emptyText, children }) {
  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  if (error) return <p className="px-4 py-6 text-body-sm text-ink-muted">Couldn't load this right now.</p>;
  if (empty) return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyText} className="py-8" />;
  return children;
}

function statusFor(mailbox) {
  if (!mailbox.isActive) return { tone: "neutral", label: "Paused" };
  const queue = mailbox.emailQueueId;
  if (!queue) return { tone: "warning", label: "No queue linked" };
  if (queue.active === false) return { tone: "warning", label: "Queue inactive" };
  return { tone: "success", label: "Active" };
}

/* -------------------------------- panels -------------------------------- */

function MailboxHealth() {
  const query = useJson(["adminMailboxes"], "/v1/mailboxes");
  const mailboxes = query.data?.mailboxes || [];
  return (
    <Panel>
      <PanelHeader
        title="Mailbox health"
        description="Inbound addresses and the queue each one reads from"
        actions={
          <Button as={Link} to="/admin/mailboxes" variant="ghost" size="sm">
            Manage
          </Button>
        }
      />
      <PanelState
        loading={query.isPending}
        error={query.isError}
        empty={query.isSuccess && mailboxes.length === 0}
        emptyIcon={Mail}
        emptyTitle="No mailboxes yet"
        emptyText="Create a mailbox to start receiving email as tickets."
      >
        <ul className="divide-y divide-line">
          {mailboxes.map((mailbox) => {
            const status = statusFor(mailbox);
            return (
              <li key={mailbox._id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body-sm font-medium text-ink">{mailbox.name}</div>
                  <div className="truncate text-caption text-ink-faint">{mailbox.emailAddress}</div>
                </div>
                <Badge tone={status.tone} dot>
                  {status.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      </PanelState>
    </Panel>
  );
}

function QueueHealth() {
  const queues = useJson(["adminQueues"], "/v1/email-queue/all");
  const mailer = useJson(["adminMailer"], "/v1/monitoring/mailer?windowHours=24", { refetchInterval: 60_000 });
  const list = queues.data?.queues || [];
  const totals = mailer.data?.totals || {};
  const metrics = mailer.data?.windowMetrics || {};
  const dead = totals.dead || 0;
  const failed = totals.failed || 0;
  const healthy = dead === 0 && failed === 0;

  return (
    <Panel>
      <PanelHeader
        title="Email queue health"
        description="Connections and outbound delivery, last 24 hours"
        actions={
          <Button as={Link} to="/admin/mailer-ops" variant="ghost" size="sm">
            Mailer ops
          </Button>
        }
      />
      <PanelState
        loading={queues.isPending}
        error={queues.isError}
        empty={queues.isSuccess && list.length === 0}
        emptyIcon={Inbox}
        emptyTitle="No email queues"
        emptyText="Connect an IMAP/SMTP or Gmail account to receive and send email."
      >
        <ul className="divide-y divide-line">
          {list.map((queue) => (
            <li key={queue._id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-body-sm font-medium text-ink">{queue.name}</div>
                <div className="truncate text-caption text-ink-faint">
                  {queue.username} · {queue.serviceType}
                </div>
              </div>
              <Badge tone={queue.active ? "success" : "neutral"} dot>
                {queue.active ? "Active" : "Inactive"}
              </Badge>
            </li>
          ))}
        </ul>
        {mailer.isSuccess ? (
          <div className="border-t border-line px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-caption font-medium text-ink-muted">Outbound delivery</span>
              <Badge tone={healthy ? "success" : "danger"} dot>
                {healthy ? "Healthy" : `${dead + failed} need attention`}
              </Badge>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[
                ["Sent", metrics.sent ?? 0],
                ["Retries", metrics.retries ?? 0],
                ["Success", `${metrics.successRate ?? 0}%`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dd className="text-title font-semibold tabular-nums text-ink">{value}</dd>
                  <dt className="text-caption text-ink-faint">{label}</dt>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </PanelState>
    </Panel>
  );
}

const EVENT_LABELS = {
  job_sent: { text: "Email sent", tone: "success" },
  job_retry: { text: "Email retry scheduled", tone: "warning" },
  job_dead: { text: "Email failed permanently", tone: "danger" },
};

function RecentActivity({ summary }) {
  const mailer = useJson(["adminMailer"], "/v1/monitoring/mailer?windowHours=24");
  const entries = [
    ...(summary.data?.recent || []).map((ticket) => ({
      key: `t-${ticket.id}`,
      at: ticket.createdAt,
      title: `${ticket.number || "Ticket"} · ${ticket.title}`,
      meta: ticket.assignee ? `Assigned to ${ticket.assignee}` : "Unassigned",
      badge: <Badge>Ticket</Badge>,
      to: `/admin/tickets?ticketId=${ticket.id}`,
    })),
    ...(mailer.data?.recentAudit || [])
      .filter((log) => EVENT_LABELS[log.eventType])
      .slice(0, 8)
      .map((log) => ({
        key: `a-${log._id}`,
        at: log.at,
        title: EVENT_LABELS[log.eventType].text,
        meta: log.metadata?.subject || "",
        badge: <Badge tone={EVENT_LABELS[log.eventType].tone}>Email</Badge>,
      })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 10);

  return (
    <Panel>
      <PanelHeader title="Recent activity" description="New tickets and email delivery events" />
      <PanelState
        loading={summary.isPending}
        error={summary.isError}
        empty={summary.isSuccess && entries.length === 0}
        emptyIcon={Clock}
        emptyTitle="Nothing yet"
        emptyText="New tickets and delivery events will show up here."
      >
        <ul className="divide-y divide-line">
          {entries.map((entry) => {
            const row = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body-sm text-ink">{entry.title}</div>
                  {entry.meta ? <div className="truncate text-caption text-ink-faint">{entry.meta}</div> : null}
                </div>
                {entry.badge}
                <span className="w-24 shrink-0 whitespace-nowrap text-right text-caption text-ink-faint">{timeAgo(entry.at, "")}</span>
              </>
            );
            return (
              <li key={entry.key}>
                {entry.to ? (
                  <Link to={entry.to} className={cn("flex items-center gap-3 px-4 py-2.5 hover:bg-subtle", focusRing)}>
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2.5">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      </PanelState>
    </Panel>
  );
}

function SetupChecklist() {
  const { fetchWithAuth } = useUser();
  const users = useQuery({ queryKey: USERS_KEY, queryFn: () => fetchUsers(fetchWithAuth), staleTime: 60_000, retry: false });
  const roles = useQuery({ queryKey: ROLES_KEY, queryFn: () => fetchRoles(fetchWithAuth), staleTime: 60_000, retry: false });
  const queues = useJson(["adminQueues"], "/v1/email-queue/all");
  const mailboxes = useJson(["adminMailboxes"], "/v1/mailboxes");
  const smtp = useJson(["adminSmtp"], "/v1/config/authentication/email", { staleTime: 5 * 60_000 });

  const loading = [users, roles, queues, mailboxes, smtp].some((q) => q.isPending);
  const steps = [
    { label: "Invite your team", text: "Add agents so tickets can be assigned.", done: (users.data?.length || 0) > 1, to: "/admin/users/new" },
    { label: "Connect an email queue", text: "Receive customer email as tickets.", done: (queues.data?.queues?.length || 0) > 0, to: "/admin/email-queues/new" },
    { label: "Create a mailbox", text: "Group inbound addresses per team.", done: (mailboxes.data?.mailboxes?.length || 0) > 0, to: "/admin/mailboxes" },
    { label: "Configure outbound email", text: "Send replies and notifications over SMTP.", done: Boolean(smtp.data?.active), to: "/admin/smtp" },
    { label: "Define roles", text: "Limit what each person can do.", done: (roles.data?.length || 0) > 0, to: "/admin/roles/new" },
  ];
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <Panel>
      <PanelHeader title="Setup checklist" description={loading ? "Checking…" : `${doneCount} of ${steps.length} complete`} />
      <div className="px-4 pt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
      </div>
      <ul className="p-2">
        {steps.map((step) => (
          <li key={step.label}>
            <Link to={step.to} className={cn("flex items-start gap-3 rounded-ds px-2 py-2 hover:bg-subtle", focusRing)}>
              {step.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-label="Done" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-line-strong" aria-label="Not done" />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-body-sm font-medium", step.done ? "text-ink-muted line-through" : "text-ink")}>{step.label}</span>
                {!step.done ? <span className="block text-caption text-ink-faint">{step.text}</span> : null}
              </span>
              {!step.done ? <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden="true" /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* --------------------------------- page --------------------------------- */

export default function AdminHome() {
  const summary = useAdminSummary();
  const data = summary.data || {};
  return (
    <Page variant="wide">
      <PageHeader title="Overview" description="What needs attention across support and email today." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Open tickets" value={data.open ?? 0} hint="Not yet resolved" to="/admin/tickets" loading={summary.isPending} icon={Inbox} />
        <StatTile label="Unassigned" value={data.unassigned ?? 0} hint="Open with no owner" to="/admin/tickets" loading={summary.isPending} tone="warning" icon={UserX} />
        {/* TEMPORARY PLACEHOLDER: this is NOT the SLA overdue metric. Swap for the real SLA calculation when SLA exists. */}
        <StatTile label="No update · 24h" value={data.noUpdate24h ?? 0} hint="Placeholder, not SLA overdue" to="/admin/tickets" loading={summary.isPending} tone="warning" icon={Clock} />
      </div>
      {summary.isError ? (
        <p className="text-body-sm text-danger-ink" role="alert">
          Ticket counts could not be loaded.{" "}
          <button type="button" className="underline" onClick={() => summary.refetch()}>
            Retry
          </button>
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <RecentActivity summary={summary} />
          <MailboxHealth />
        </div>
        <div className="space-y-5">
          <SetupChecklist />
          <QueueHealth />
        </div>
      </div>
    </Page>
  );
}

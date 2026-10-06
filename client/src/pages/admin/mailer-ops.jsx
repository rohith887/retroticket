// Admin > Mailer ops. Delivery health, dead-letter retries and the audit explorer.
// API unchanged: GET /v1/monitoring/mailer, GET /v1/email-queue/jobs, POST /v1/email-queue/jobs/:id/retry, GET /v1/audit-logs.
// Retrying several jobs calls the existing single-job retry endpoint once per job; there is no bulk endpoint.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Copy, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useUser } from "../../store/session";
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Detail,
  Drawer,
  DrawerContent,
  EmptyState,
  Field,
  Input,
  Page,
  PageHeader,
  Panel,
  PanelHeader,
  Select,
  Skeleton,
  StatTile,
  TabPanel,
  Tabs,
  cn,
  toast,
  tokenColor,
} from "../../ui";
import { formatDateTime, timeAgo } from "../../ui/time";

const MAILER_KEY = ["adminMailer"];
const DEAD_KEY = ["adminDeadJobs"];
const AUDIT_LIMIT = 20;
// The event types the mailer writes and the metrics endpoint counts (see api/src/controllers/monitoring.js).
const EVENT_OPTIONS = [
  { value: "job_enqueued", label: "Enqueued" },
  { value: "job_sent", label: "Sent" },
  { value: "job_retry", label: "Retry" },
  { value: "job_dead", label: "Dead" },
];
const EVENT_TONES = { job_sent: "success", job_retry: "warning", job_dead: "danger", job_enqueued: "neutral" };
const QUICK_RANGES = [
  { value: "1h", label: "1h", hours: 1 },
  { value: "24h", label: "24h", hours: 24 },
  { value: "7d", label: "7d", hours: 168 },
];
const EMPTY_FILTERS = { eventType: "", entityId: "", startDate: "", endDate: "", range: "" };

async function getJson(fetchWithAuth, path) {
  const res = await fetchWithAuth(path);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

const pad = (n) => String(n).padStart(2, "0");
/** Local time in the datetime-local format the filter inputs (and the API's Date parsing) already use. */
function localInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const eventLabel = (type) => EVENT_OPTIONS.find((o) => o.value === type)?.label || type;
const actorOf = (log) => log.actor?.actorName || log.actor?.actorEmail || log.actor?.actorType || "";

function latencyText(ms) {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms} ms`;
}

/* ------------------------------- health banner ------------------------------- */

const healthTones = {
  healthy: { box: "border-success/30 bg-success-soft text-success-ink", dot: "bg-success", label: "Healthy", Icon: CheckCircle2 },
  degraded: { box: "border-warning/30 bg-warning-soft text-warning-ink", dot: "bg-warning", label: "Degraded", Icon: AlertTriangle },
  attention: { box: "border-danger/30 bg-danger-soft text-danger-ink", dot: "bg-danger", label: "Needs attention", Icon: ShieldAlert },
};

/** Derived only from the numbers the API returns: dead letters, retries and failed jobs. No thresholds are invented. */
function healthOf({ deadCount, retries, failed }) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (deadCount > 0) {
    return { tone: "attention", message: `${plural(deadCount, "message")} ${deadCount === 1 ? "is" : "are"} in the dead-letter queue and require action.`, detail: `${retries} ${retries === 1 ? "retry" : "retries"} · ${failed} failed` };
  }
  if (retries > 0 || failed > 0) {
    return { tone: "degraded", message: "Some messages are retrying and may require attention.", detail: `${retries} ${retries === 1 ? "retry" : "retries"} · ${failed} failed · 0 dead letters` };
  }
  return { tone: "healthy", message: "All outbound mail is delivering normally.", detail: "0 dead letters · 0 retries" };
}

function HealthBanner({ health, onViewDead }) {
  const t = healthTones[health.tone];
  return (
    <div role={health.tone === "healthy" ? "status" : "alert"} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-ds-lg border px-4 py-3", t.box)} aria-label={`Mailer status: ${t.label}`}>
      <span className="flex items-center gap-2 text-body-sm font-semibold uppercase tracking-wide">
        <span className={cn("h-2.5 w-2.5 rounded-full", t.dot)} aria-hidden="true" />
        {t.label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-body-sm font-medium">{health.message}</div>
        <div className="text-caption opacity-80">{health.detail}</div>
      </div>
      {health.tone === "attention" ? (
        <Button size="sm" onClick={onViewDead}>
          View dead letters
        </Button>
      ) : null}
    </div>
  );
}

/* ---------------------------------- chart ---------------------------------- */

function HourlyChart({ data }) {
  const axis = tokenColor("--ds-ink-faint");
  const grid = tokenColor("--ds-line");
  return (
    <div className="h-60 w-full" role="img" aria-label="Hourly sent, retry and dead-letter event counts for the last 24 hours">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: grid }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <ChartTooltip
            cursor={{ fill: tokenColor("--ds-subtle") }}
            contentStyle={{ background: tokenColor("--ds-surface"), border: `1px solid ${grid}`, borderRadius: 8, fontSize: 12, color: tokenColor("--ds-ink") }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
          <Bar dataKey="sent" name="Sent" fill={tokenColor("--ds-brand")} radius={[3, 3, 0, 0]} />
          <Bar dataKey="retry" name="Retry" fill={tokenColor("--ds-warning")} radius={[3, 3, 0, 0]} />
          <Bar dataKey="dead" name="Dead" fill={tokenColor("--ds-danger")} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------- queue block ------------------------------- */

function QueueStat({ label, hint, value, tone, loading }) {
  const attention = tone === "warning" && Number(value) > 0;
  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-ds border px-3 py-2.5", attention ? "border-warning/30 bg-warning-soft" : "border-line bg-subtle")}>
      <div className="min-w-0">
        <div className="text-body-sm font-medium text-ink">{label}</div>
        <div className="text-caption text-ink-faint">{hint}</div>
      </div>
      <div className={cn("text-[22px] font-semibold tabular-nums", attention ? "text-warning-ink" : "text-ink")}>{loading ? <Skeleton className="h-6 w-8" /> : value}</div>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function MailerOps() {
  const { fetchWithAuth } = useUser();
  const [retryingId, setRetryingId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [tab, setTab] = useState("dead");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [auditPage, setAuditPage] = useState(1);
  const [openLog, setOpenLog] = useState(null);
  const [openJob, setOpenJob] = useState(null);
  const [, setTick] = useState(0); // only re-renders the "Last updated" text; it does not fetch anything

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  const metricsQuery = useQuery({ queryKey: MAILER_KEY, queryFn: () => getJson(fetchWithAuth, "/v1/monitoring/mailer?windowHours=24"), staleTime: 15_000, refetchInterval: 60_000 });
  const deadQuery = useQuery({ queryKey: DEAD_KEY, queryFn: async () => (await getJson(fetchWithAuth, "/v1/email-queue/jobs?status=dead&limit=100")).jobs || [], staleTime: 15_000 });

  const auditQuery = useQuery({
    queryKey: ["adminAudit", applied, auditPage],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(auditPage), limit: String(AUDIT_LIMIT) });
      const { range: _range, ...apiFilters } = applied; // `range` only remembers which quick range set the dates
      Object.entries(apiFilters).forEach(([key, value]) => value && params.set(key, value));
      const result = await getJson(fetchWithAuth, `/v1/audit-logs?${params.toString()}`);
      if (result.success === false) throw new Error(result.message || "Failed to fetch audit logs");
      return { logs: result.logs || [], pagination: result.pagination || { page: 1, total: 0, totalPages: 1 } };
    },
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });

  const metrics = metricsQuery.data?.windowMetrics || {};
  const totals = metricsQuery.data?.totals || {};
  const trends = useMemo(() => (Array.isArray(metricsQuery.data?.trends) ? metricsQuery.data.trends : []), [metricsQuery.data]);
  const loadingMetrics = metricsQuery.isPending;
  const deadJobs = deadQuery.data || [];
  const deadCount = deadQuery.isSuccess ? deadJobs.length : Number(totals.dead) || 0;
  const hasActivity = trends.some((row) => (row.sent || 0) + (row.retry || 0) + (row.dead || 0) > 0);
  const refreshing = metricsQuery.isFetching || deadQuery.isFetching || auditQuery.isFetching;
  const health = healthOf({ deadCount, retries: Number(metrics.retries) || 0, failed: Number(totals.failed) || 0 });

  function refreshAll() {
    if (refreshing) return;
    metricsQuery.refetch();
    deadQuery.refetch();
    auditQuery.refetch();
  }

  async function retryOne(id) {
    const res = await fetchWithAuth(`/v1/email-queue/jobs/${id}/retry`, { method: "POST" });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.success === false) throw new Error(result.message || "Retry failed");
  }

  async function retryJob(job) {
    setRetryingId(job._id);
    try {
      await retryOne(job._id);
      toast.success("Job re-queued for retry");
      metricsQuery.refetch();
      deadQuery.refetch();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRetryingId(null);
    }
  }

  async function retryMany(jobs) {
    setBulkBusy(true);
    let ok = 0;
    let firstError = null;
    for (const job of jobs) {
      try {
        await retryOne(job._id);
        ok += 1;
      } catch (error) {
        firstError = firstError || error.message;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (ok) toast.success(`${ok} job${ok === 1 ? "" : "s"} re-queued for retry`);
    if (firstError) toast.error(`${jobs.length - ok} could not be re-queued: ${firstError}`);
    metricsQuery.refetch();
    deadQuery.refetch();
  }

  const selectedJobs = deadJobs.filter((j) => selected.has(j._id));

  const deadColumns = [
    { id: "created", header: "Created", sortValue: (j) => new Date(j.createdAt).getTime(), className: "whitespace-nowrap text-ink-muted", cell: (j) => <span title={formatDateTime(j.createdAt)}>{timeAgo(j.createdAt)}</span> },
    { id: "to", header: "To", cell: (j) => <span className="block max-w-[14rem] truncate">{(j.payload?.to || []).join(", ") || "—"}</span> },
    { id: "subject", header: "Subject", hideBelow: "lg", cell: (j) => <span className="block max-w-[18rem] truncate">{j.payload?.subject || "—"}</span> },
    {
      id: "attempts",
      header: "Attempts",
      className: "tabular-nums",
      cell: (j) => (j.attempt >= j.maxAttempts ? <Badge tone="danger">{`${j.attempt}/${j.maxAttempts}`}</Badge> : `${j.attempt}/${j.maxAttempts}`),
    },
    { id: "error", header: "Last error", hideBelow: "xl", cell: (j) => <span className="block max-w-[20rem] truncate text-danger-ink" title={j.lastError || ""}>{j.lastError || "—"}</span> },
  ];

  const auditColumns = [
    { id: "event", header: "Event", cell: (l) => <Badge tone={EVENT_TONES[l.eventType] || "neutral"}>{l.eventType}</Badge> },
    { id: "at", header: "When", className: "whitespace-nowrap text-ink-muted", cell: (l) => <span title={formatDateTime(l.at || l.createdAt)}>{timeAgo(l.at || l.createdAt)}</span> },
    { id: "entity", header: "Entity", hideBelow: "lg", className: "font-mono text-caption text-ink-muted", cell: (l) => l.entityId || "—" },
    { id: "actor", header: "Actor", hideBelow: "xl", className: "text-ink-muted", cell: (l) => actorOf(l) || "—" },
  ];

  const pagination = auditQuery.data?.pagination;
  const filtersDirty = JSON.stringify(filters) !== JSON.stringify(applied);
  const hasApplied = JSON.stringify(applied) !== JSON.stringify(EMPTY_FILTERS);

  function applyFilters(e) {
    e.preventDefault();
    setAuditPage(1);
    setApplied(filters);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setAuditPage(1);
  }

  function quickRange(range) {
    const end = new Date();
    const next = { ...filters, range: range.value, startDate: localInputValue(new Date(end.getTime() - range.hours * 3600_000)), endDate: "" };
    setFilters(next);
    setApplied(next);
    setAuditPage(1);
  }

  function removeFilter(keys) {
    const clear = Object.fromEntries(keys.map((k) => [k, ""]));
    setFilters((c) => ({ ...c, ...clear }));
    setApplied((c) => ({ ...c, ...clear }));
    setAuditPage(1);
  }

  const rangeLabel = QUICK_RANGES.find((r) => r.value === applied.range)?.label;
  const chips = [
    applied.eventType ? { id: "event", label: `Event: ${eventLabel(applied.eventType)}`, keys: ["eventType"] } : null,
    applied.entityId ? { id: "entity", label: `Entity: ${applied.entityId.length > 12 ? `${applied.entityId.slice(0, 10)}…` : applied.entityId}`, keys: ["entityId"] } : null,
    rangeLabel ? { id: "range", label: `Last ${rangeLabel}`, keys: ["range", "startDate", "endDate"] } : null,
    !rangeLabel && applied.startDate ? { id: "from", label: `From ${applied.startDate.replace("T", " ")}`, keys: ["startDate"] } : null,
    !rangeLabel && applied.endDate ? { id: "to", label: `To ${applied.endDate.replace("T", " ")}`, keys: ["endDate"] } : null,
  ].filter(Boolean);

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <Page variant="wide">
      <PageHeader
        title="Mailer ops"
        description="Outbound delivery health for the last 24 hours."
        actions={
          <div className="flex items-center gap-3">
            {metricsQuery.dataUpdatedAt ? (
              <span className="hidden text-caption text-ink-faint sm:inline" title={formatDateTime(metricsQuery.dataUpdatedAt)}>
                Last updated {timeAgo(metricsQuery.dataUpdatedAt).toLowerCase()}
              </span>
            ) : null}
            <Button onClick={refreshAll} loading={refreshing && !loadingMetrics} disabled={refreshing}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        }
      />

      {metricsQuery.isError ? (
        <EmptyState title="We couldn't load delivery metrics" description={metricsQuery.error.message} action={<Button onClick={() => metricsQuery.refetch()}>Try again</Button>} />
      ) : (
        <>
          {loadingMetrics ? <Skeleton className="h-16 w-full rounded-ds-lg" /> : <HealthBanner health={health} onViewDead={() => setTab("dead")} />}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile label="Success rate" value={`${metrics.successRate ?? 0}%`} hint="Last 24h" loading={loadingMetrics} />
            <StatTile label="Sent" value={(metrics.sent ?? 0).toLocaleString()} hint="Last 24h" loading={loadingMetrics} />
            <StatTile label="Retries" value={metrics.retries ?? 0} hint="Last 24h" tone="warning" loading={loadingMetrics} />
            <StatTile label="Dead" value={metrics.dead ?? 0} hint="Last 24h" tone="danger" loading={loadingMetrics} />
            <StatTile label="p95 latency" value={latencyText(metrics.latency?.p95Ms)} hint="Queued → sent" loading={loadingMetrics} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel className="lg:col-span-2">
              <PanelHeader title="Hourly trend" description="Sent, retry and dead-letter events per hour" />
              <div className="p-4">
                {loadingMetrics ? (
                  <Skeleton className="h-60 w-full" />
                ) : hasActivity ? (
                  <HourlyChart data={trends} />
                ) : (
                  <EmptyState title="No mail activity in the last 24 hours." className="py-10" />
                )}
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Queue now" description="Jobs currently in the queue" />
              <div className="flex flex-col gap-2 p-4">
                <QueueStat label="Pending" hint="Waiting to send" value={totals.pending ?? 0} loading={loadingMetrics} />
                <QueueStat label="Processing" hint="Being sent" value={totals.processing ?? 0} loading={loadingMetrics} />
                <QueueStat label="Failed" hint="Will retry" value={totals.failed ?? 0} tone="warning" loading={loadingMetrics} />
              </div>
            </Panel>
          </div>
        </>
      )}

      <Panel>
        <div className="px-4 pt-2">
          <Tabs
            idBase="mailer"
            label="Dead letters and audit log"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: "dead", label: "Dead letters", count: deadQuery.isSuccess ? deadJobs.length : undefined },
              { value: "audit", label: "Audit log" },
            ]}
          />
        </div>

        <TabPanel idBase="mailer" value="dead" active={tab === "dead"} className="flex flex-col gap-3 p-4">
          {deadCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-ds border border-danger/30 bg-danger-soft px-3 py-2">
              <div className="text-body-sm text-danger-ink">
                <span className="font-semibold">{deadCount === 1 ? "1 message requires" : `${deadCount} messages require`} attention.</span> Retrying puts them back in the queue.
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => retryMany(selectedJobs)} disabled={selectedJobs.length === 0 || bulkBusy} loading={bulkBusy}>
                  Retry selected{selectedJobs.length ? ` (${selectedJobs.length})` : ""}
                </Button>
                <Button size="sm" variant="primary" onClick={() => setConfirmAll(true)} disabled={deadJobs.length === 0 || bulkBusy}>
                  Retry all
                </Button>
              </div>
            </div>
          ) : null}
          <DataTable
            label="Dead-letter queue"
            columns={deadColumns}
            rows={deadJobs}
            getRowId={(j) => j._id}
            loading={deadQuery.isPending}
            error={deadQuery.isError ? deadQuery.error : null}
            onRetry={() => deadQuery.refetch()}
            initialSort={{ id: "created", dir: "desc" }}
            pageSize={10}
            selected={selected}
            onSelectedChange={setSelected}
            onRowClick={setOpenJob}
            rowActions={(j) => (
              <Button size="sm" onClick={() => retryJob(j)} loading={retryingId === j._id} disabled={bulkBusy}>
                Retry
              </Button>
            )}
            empty={<EmptyState icon={CheckCircle2} title="No dead letters" description="Every message has been delivered or is still retrying." className="py-8" />}
          />
        </TabPanel>

        <TabPanel idBase="mailer" value="audit" active={tab === "audit"} className="flex flex-col gap-3 p-4">
          <form onSubmit={applyFilters} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            <Field label="Event type">
              {(f) => (
                <Select {...f} value={filters.eventType} onChange={(e) => setFilters((c) => ({ ...c, eventType: e.target.value }))}>
                  <option value="">All events</option>
                  {EVENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Entity id">{(f) => <Input {...f} value={filters.entityId} onChange={(e) => setFilters((c) => ({ ...c, entityId: e.target.value }))} />}</Field>
            <Field label="From">{(f) => <Input {...f} type="datetime-local" value={filters.startDate} onChange={(e) => setFilters((c) => ({ ...c, startDate: e.target.value, range: "" }))} />}</Field>
            <Field label="To">{(f) => <Input {...f} type="datetime-local" value={filters.endDate} onChange={(e) => setFilters((c) => ({ ...c, endDate: e.target.value, range: "" }))} />}</Field>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={!filtersDirty}>
                Apply
              </Button>
              <Button onClick={resetFilters} disabled={!hasApplied && !filtersDirty}>
                Reset
              </Button>
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-ink-faint">Quick range</span>
            {QUICK_RANGES.map((r) => (
              <Button key={r.value} size="sm" variant={applied.range === r.value ? "primary" : "secondary"} onClick={() => quickRange(r)}>
                {r.label}
              </Button>
            ))}
            {chips.length ? <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" /> : null}
            {chips.map((chip) => (
              <span key={chip.id} className="inline-flex h-7 items-center gap-1 rounded-ds border border-brand-softline bg-brand-soft pl-2.5 pr-1 text-caption font-medium text-brand-ink">
                {chip.label}
                <button type="button" onClick={() => removeFilter(chip.keys)} aria-label={`Remove filter ${chip.label}`} className="rounded p-0.5 hover:bg-brand-softline">
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>

          <DataTable
            label="Audit events"
            columns={auditColumns}
            rows={auditQuery.data?.logs || []}
            getRowId={(l) => l._id}
            loading={auditQuery.isPending}
            error={auditQuery.isError ? auditQuery.error : null}
            onRetry={() => auditQuery.refetch()}
            onRowClick={setOpenLog}
            pageSize={AUDIT_LIMIT}
            empty={<EmptyState title="No audit events found for the selected filters." description={hasApplied ? "Try widening the filters." : "No delivery events have been recorded yet."} className="py-8" />}
          />

          {pagination && pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between text-body-sm text-ink-muted">
              <span>
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} events)
              </span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setAuditPage((p) => Math.max(1, p - 1))} disabled={pagination.page <= 1 || auditQuery.isFetching}>
                  Previous
                </Button>
                <Button size="sm" onClick={() => setAuditPage((p) => Math.min(pagination.totalPages, p + 1))} disabled={pagination.page >= pagination.totalPages || auditQuery.isFetching}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </TabPanel>
      </Panel>

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Retry all dead letters?"
        description={`${deadJobs.length} message${deadJobs.length === 1 ? "" : "s"} will be put back in the queue, one retry request each.`}
        confirmLabel="Retry all"
        tone="primary"
        onConfirm={() => retryMany(deadJobs)}
      />

      <Drawer open={Boolean(openJob)} onOpenChange={(open) => !open && setOpenJob(null)}>
        {openJob ? (
          <DrawerContent title="Dead letter" description={(openJob.payload?.to || []).join(", ") || undefined}>
            <dl className="divide-y divide-line px-4 py-1">
              <Detail label="Subject">{openJob.payload?.subject || "—"}</Detail>
              <Detail label="Created">{formatDateTime(openJob.createdAt) || "—"}</Detail>
              <Detail label="Last updated">{formatDateTime(openJob.updatedAt) || "—"}</Detail>
              <Detail label="Attempts">{`${openJob.attempt}/${openJob.maxAttempts}`}</Detail>
              <Detail label="Job id">
                <span className="font-mono text-caption">{openJob._id}</span>
              </Detail>
            </dl>
            <div className="px-4 pb-4">
              <div className="mb-1.5 text-caption font-medium text-ink-muted">Last error</div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-ds border border-danger/30 bg-danger-soft p-3 font-mono text-caption text-danger-ink">{openJob.lastError || "No error recorded."}</pre>
              <div className="mt-3">
                <Button size="sm" onClick={() => { retryJob(openJob); setOpenJob(null); }} disabled={bulkBusy}>
                  Retry this job
                </Button>
              </div>
            </div>
          </DrawerContent>
        ) : null}
      </Drawer>

      <Drawer open={Boolean(openLog)} onOpenChange={(open) => !open && setOpenLog(null)}>
        {openLog ? (
          <DrawerContent title={openLog.eventType} description={formatDateTime(openLog.at || openLog.createdAt)}>
            <dl className="divide-y divide-line px-4 py-1">
              <Detail label="Event"><Badge tone={EVENT_TONES[openLog.eventType] || "neutral"}>{openLog.eventType}</Badge></Detail>
              <Detail label="Entity">{`${openLog.entityType || "—"} · ${openLog.entityId || "—"}`}</Detail>
              <Detail label="Actor">{openLog.actor?.actorType ? `${openLog.actor.actorType}${openLog.actor.actorId ? ` · ${openLog.actor.actorId}` : ""}` : "—"}</Detail>
              <Detail label="Request">
                {openLog.requestId ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-caption">{openLog.requestId}</span>
                    <Button size="sm" variant="ghost" onClick={() => copy(openLog.requestId)} aria-label="Copy request ID">
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                  </span>
                ) : (
                  "—"
                )}
              </Detail>
            </dl>
            <div className="px-4 pb-4">
              <div className="mb-1.5 text-caption font-medium text-ink-muted">Metadata</div>
              <pre className="max-h-96 overflow-auto rounded-ds border border-line bg-subtle p-3 font-mono text-caption text-ink">{JSON.stringify(openLog.metadata ?? {}, null, 2)}</pre>
            </div>
          </DrawerContent>
        ) : null}
      </Drawer>
    </Page>
  );
}

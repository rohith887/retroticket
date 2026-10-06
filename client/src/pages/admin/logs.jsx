// Admin > Logs. Recent server log lines from GET /v1/data/logs (newest first, last 1000 lines).
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScrollText } from "lucide-react";
import { useUser } from "../../store/session";
import { Badge, Button, DataTable, Detail, Drawer, DrawerContent, EmptyState, FilterChip, Page, PageHeader, SearchInput } from "../../ui";
import { formatDateTime, timeAgo } from "../../ui/time";

// pino numeric levels
const LEVELS = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };
const LEVEL_TONE = { trace: "neutral", debug: "neutral", info: "neutral", warn: "warning", error: "danger", fatal: "danger" };
const levelName = (log) => (typeof log.level === "number" ? LEVELS[log.level] || String(log.level) : String(log.level || "log"));

async function fetchLogs(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/data/logs");
  if (!res.ok) throw new Error(`Could not load logs (${res.status})`);
  const data = await res.json();
  if (data.success === false) throw new Error(data.error || "Could not load logs");
  const lines = String(data.logs || "").split("\n").filter((line) => line.trim()).slice(-1000);
  return lines
    .map((line, index) => {
      try {
        return { ...JSON.parse(line), _key: index };
      } catch {
        return { time: new Date().toISOString(), msg: line, _key: index };
      }
    })
    .sort((a, b) => (new Date(b.time).getTime() || 0) - (new Date(a.time).getTime() || 0));
}

export default function Logs() {
  const { fetchWithAuth } = useUser();
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState(null);
  const [open, setOpen] = useState(null);

  const query = useQuery({ queryKey: ["adminLogs"], queryFn: () => fetchLogs(fetchWithAuth), staleTime: 15_000, retry: false });
  const logs = query.data || [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return logs.filter((log) => (!level || levelName(log) === level) && (!term || String(log.msg || "").toLowerCase().includes(term)));
  }, [logs, search, level]);

  const columns = [
    { id: "time", header: "Time", sortValue: (l) => new Date(l.time).getTime() || 0, className: "w-52 whitespace-nowrap text-ink-muted", cell: (l) => <span title={timeAgo(l.time, "")}>{formatDateTime(l.time) || "—"}</span> },
    { id: "level", header: "Level", sortValue: (l) => levelName(l), cell: (l) => <Badge tone={LEVEL_TONE[levelName(l)] || "neutral"}>{levelName(l)}</Badge> },
    { id: "msg", header: "Message", cell: (l) => <span className="block max-w-[48rem] truncate" title={l.msg}>{l.msg || "—"}</span> },
  ];

  return (
    <Page>
      <PageHeader
        title="Logs"
        description="The most recent server log entries."
        actions={
          <Button onClick={() => query.refetch()} loading={query.isFetching && !query.isPending}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search messages" aria-label="Search log messages" className="w-full sm:w-64" />
        <FilterChip
          label="Level"
          value={level}
          onChange={setLevel}
          anyLabel="Any level"
          options={["error", "warn", "info", "debug"].map((name) => ({ value: name, label: name }))}
        />
        <span className="ml-auto text-body-sm text-ink-muted">{query.isSuccess ? `${filtered.length} entries` : ""}</span>
      </div>

      <DataTable
        label="Logs"
        columns={columns}
        rows={filtered}
        getRowId={(l) => l._key}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => query.refetch()}
        onRowClick={setOpen}
        initialSort={{ id: "time", dir: "desc" }}
        resetKey={`${search}|${level}`}
        pageSize={50}
        empty={<EmptyState icon={ScrollText} title={search || level ? "No entries match your filters" : "No log entries"} description={search || level ? "Try clearing the filters." : "Nothing has been logged yet."} />}
      />

      <Drawer open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        {open ? (
          <DrawerContent title="Log entry" description={formatDateTime(open.time)}>
            <dl className="divide-y divide-line px-4 py-1">
              <Detail label="Level"><Badge tone={LEVEL_TONE[levelName(open)] || "neutral"}>{levelName(open)}</Badge></Detail>
              <Detail label="Message">{open.msg || "—"}</Detail>
            </dl>
            <div className="px-4 pb-4">
              <div className="mb-1.5 text-caption font-medium text-ink-muted">Raw entry</div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-ds border border-line bg-subtle p-3 font-mono text-caption text-ink">
                {JSON.stringify(Object.fromEntries(Object.entries(open).filter(([key]) => key !== "_key")), null, 2)}
              </pre>
            </div>
          </DrawerContent>
        ) : null}
      </Drawer>
    </Page>
  );
}

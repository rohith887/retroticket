// Right-hand properties panel: Assignment, Status, Priority, Client, Case, Details.
// Every control maps to an existing endpoint (see model.js). Controls are disabled when the role lacks issue::update.
import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCheck, RotateCcw, UserCheck, UserX } from "lucide-react";
import { useUser } from "../../store/session";
import { usePermissions } from "../../store/permissions";
import { fetchUsers, USERS_KEY } from "../../pages/admin/users/api";
import { Avatar, Button, Select } from "../../ui";
import { formatDateTime } from "../../ui/time";
import { AiPanel } from "./ai/AiPanel";
import { useBase } from "./useTicketBase";
import { PRIORITIES, STATUSES, assigneeIdOf, assigneeOf, clientNameOf, humanize, requesterOf } from "./model";

function Group({ title, children }) {
  return (
    <section className="border-b border-line px-4 py-3 last:border-b-0">
      <h3 className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-faint">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, children }) {
  if (!children) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-body-sm">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-ink" title={typeof children === "string" ? children : undefined}>{children}</span>
    </div>
  );
}

export function AssignmentControl({ ticket, actions, disabled }) {
  const { fetchWithAuth, user } = useUser();
  const users = useQuery({ queryKey: USERS_KEY, queryFn: () => fetchUsers(fetchWithAuth), staleTime: 5 * 60_000, retry: false });
  const current = assigneeOf(ticket);
  const currentId = assigneeIdOf(ticket);
  const me = { _id: String(user?._id || user?.id), name: user?.name || user?.email };
  const mine = currentId && currentId === me._id;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-body-sm">
        {current ? (
          <>
            <Avatar name={current.name} size="sm" />
            <span className="min-w-0 truncate font-medium text-ink">{mine ? "You" : current.name}</span>
          </>
        ) : (
          <span className="text-ink-muted">Nobody is assigned</span>
        )}
      </div>
      {users.isSuccess ? (
        <Select aria-label="Assignee" value={currentId || ""} disabled={disabled} onChange={(e) => {
          const person = users.data.find((u) => u.id === e.target.value);
          actions.assign(person ? { _id: person.id, name: person.name } : null).catch(() => {});
        }}>
          <option value="">Unassigned</option>
          {users.data.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!mine ? (
          <Button size="sm" variant="primary" disabled={disabled} onClick={() => actions.assign(me).catch(() => {})}>
            <UserCheck className="h-3.5 w-3.5" /> {current ? "Take over" : "Assign to me"}
          </Button>
        ) : null}
        {current ? (
          <Button size="sm" disabled={disabled} onClick={() => actions.assign(null).catch(() => {})}>
            <UserX className="h-3.5 w-3.5" /> Unassign
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function StatusControl({ ticket, actions, disabled }) {
  const known = STATUSES.some((s) => s.value === ticket.status);
  return (
    <div className="space-y-2">
      <Select aria-label="Status" value={ticket.status || "open"} disabled={disabled || ticket.isComplete} onChange={(e) => actions.setStatus(e.target.value).catch(() => {})}>
        {!known && ticket.status ? <option value={ticket.status}>{humanize(ticket.status)}</option> : null}
        {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </Select>
      <Button size="sm" className="w-full" disabled={disabled} onClick={() => actions.setComplete(!ticket.isComplete).catch(() => {})}>
        {ticket.isComplete ? <><RotateCcw className="h-3.5 w-3.5" /> Reopen ticket</> : <><CheckCheck className="h-3.5 w-3.5" /> Mark as resolved</>}
      </Button>
      {ticket.isComplete ? <p className="text-caption text-ink-faint">Reopen the ticket to change its status.</p> : null}
    </div>
  );
}

export function TicketProperties({ ticket, actions }) {
  const { can } = usePermissions();
  const readOnly = !can("issue::update");
  const base = useBase();
  const client = clientNameOf(ticket);

  return (
    <div>
      <Group title="Assignment"><AssignmentControl ticket={ticket} actions={actions} disabled={readOnly} /></Group>
      <Group title="Status"><StatusControl ticket={ticket} actions={actions} disabled={readOnly} /></Group>
      <Group title="Priority">
        <Select aria-label="Priority" value={ticket.priority || "medium"} disabled={readOnly} onChange={(e) => actions.setPriority(e.target.value).catch(() => {})}>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
      </Group>
      <AiPanel ticket={ticket} />
      <Group title="Requester">
        <Row label="Name">{requesterOf(ticket)}</Row>
        <Row label="Email">{ticket.email}</Row>
        <Row label="Client">{client}</Row>
        <Row label="Client no.">{ticket.clientId?.number ? String(ticket.clientId.number) : null}</Row>
      </Group>
      {ticket.sourceCaseId || ticket.currentStage || ticket.threadId ? (
        <Group title="Case">
          <Row label="Case">{ticket.sourceCaseId}</Row>
          <Row label="Stage">{ticket.currentStage}</Row>
          {ticket.threadId ? (
            <Link to={`${base}/threads?threadId=${ticket.threadId._id || ticket.threadId}`} className="block text-body-sm font-medium text-brand-ink hover:underline">
              Open the email thread
            </Link>
          ) : null}
        </Group>
      ) : null}
      <Group title="Details">
        <Row label="Ticket">{ticket.number ? `#${ticket.number}` : null}</Row>
        <Row label="Created">{formatDateTime(ticket.createdAt)}</Row>
        <Row label="Updated">{formatDateTime(ticket.updatedAt)}</Row>
        <Row label="Type">{ticket.type ? humanize(ticket.type) : null}</Row>
        <Row label="Source">{ticket.fromImap ? "Email" : null}</Row>
      </Group>
    </div>
  );
}

// Admin > SMTP. Outbound email configuration and the system email templates.
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Pencil, RotateCcw } from "lucide-react";
import { useUser } from "../../../store/session";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  Detail,
  EmptyState,
  EntityCell,
  Field,
  FormActions,
  Input,
  Page,
  PageHeader,
  PasswordInput,
  Section,
  Select,
  Skeleton,
  Tooltip,
  toast,
} from "../../../ui";
import { timeAgo } from "../../../ui/time";
import { deleteSmtpConfig, fetchSmtpConfig, fetchTemplates, saveSmtpConfig, SMTP_KEY, TEMPLATES_KEY } from "./api";

/* ------------------------------ setup forms ----------------------------- */

function GmailForm({ onDone }) {
  const { fetchWithAuth } = useUser();
  const [form, setForm] = useState({ clientId: "", clientSecret: "", user: "", redirectUri: `${window.location.origin}/admin/smtp/oauth` });
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((c) => ({ ...c, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await saveSmtpConfig(fetchWithAuth, {
        host: "smtp.gmail.com",
        port: "465",
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret,
        username: form.user.trim(),
        reply: form.user.trim(),
        serviceType: "gmail",
        redirectUri: form.redirectUri.trim(),
      });
      if (data.authorizeUrl) {
        window.location.href = data.authorizeUrl; // hand off to Google's consent screen
      } else {
        onDone();
      }
    } catch (error) {
      toast.error(error.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Section title="Google OAuth" description="You will be redirected to Google to authorise sending mail.">
        <Field label="Client ID" required>{(f) => <Input {...f} value={form.clientId} onChange={set("clientId")} disabled={busy} required />}</Field>
        <Field label="Client secret" required>{(f) => <PasswordInput {...f} value={form.clientSecret} onChange={set("clientSecret")} autoComplete="off" disabled={busy} required />}</Field>
        <Field label="Gmail address" required>{(f) => <Input {...f} type="email" value={form.user} onChange={set("user")} disabled={busy} required />}</Field>
        <Field label="Redirect URI" hint="Add this exact URL to your Google OAuth client." required>
          {(f) => <Input {...f} value={form.redirectUri} onChange={set("redirectUri")} disabled={busy} required />}
        </Field>
      </Section>
      <FormActions>
        <Button type="submit" variant="primary" loading={busy} disabled={!form.clientId || !form.clientSecret || !form.user}>
          Save and authorise
        </Button>
      </FormActions>
    </form>
  );
}

function PasswordForm({ onDone }) {
  const { fetchWithAuth } = useUser();
  const [form, setForm] = useState({ host: "", port: "587", reply: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((c) => ({ ...c, [key]: e.target.value }));
  const valid = form.host && form.port && form.reply && form.username && form.password;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await saveSmtpConfig(fetchWithAuth, { host: form.host.trim(), active: true, port: form.port, reply: form.reply.trim(), username: form.username.trim(), password: form.password });
      toast.success("SMTP configuration saved");
      onDone();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Section title="SMTP server">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Host" required className="sm:col-span-2">
            {(f) => <Input {...f} value={form.host} onChange={set("host")} placeholder="smtp.company.com" disabled={busy} required />}
          </Field>
          <Field label="Port" required>{(f) => <Input {...f} inputMode="numeric" value={form.port} onChange={set("port")} disabled={busy} required />}</Field>
        </div>
        <Field label="Username" required>{(f) => <Input {...f} value={form.username} onChange={set("username")} autoComplete="off" disabled={busy} required />}</Field>
        <Field label="Password" required>{(f) => <PasswordInput {...f} value={form.password} onChange={set("password")} autoComplete="new-password" disabled={busy} required />}</Field>
        <Field label="Reply-to / from address" required hint="Recipients see replies going to this address.">
          {(f) => <Input {...f} type="email" value={form.reply} onChange={set("reply")} placeholder="support@company.com" disabled={busy} required />}
        </Field>
      </Section>
      <FormActions>
        <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
          Save configuration
        </Button>
      </FormActions>
    </form>
  );
}

function Setup({ onDone }) {
  const [provider, setProvider] = useState("");
  return (
    <div className="space-y-5">
      <Section title="Email provider" description="Outbound email (ticket notifications and replies) is sent through this account.">
        <Field label="Provider">
          {(f) => (
            <Select {...f} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="" disabled>Select a provider</option>
              <option value="gmail">Google</option>
              <option value="other">Other (SMTP username and password)</option>
              <option value="microsoft" disabled>Microsoft (not available yet)</option>
            </Select>
          )}
        </Field>
      </Section>
      {provider === "gmail" ? <GmailForm onDone={onDone} /> : null}
      {provider === "other" ? <PasswordForm onDone={onDone} /> : null}
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

export default function SmtpSettings() {
  const { fetchWithAuth } = useUser();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const configQuery = useQuery({ queryKey: SMTP_KEY, queryFn: () => fetchSmtpConfig(fetchWithAuth), staleTime: 0, retry: false });
  const state = configQuery.data;
  const templatesQuery = useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: () => fetchTemplates(fetchWithAuth),
    enabled: Boolean(state?.configured && state?.verified),
    staleTime: 60_000,
  });

  const remove = async () => {
    await deleteSmtpConfig(fetchWithAuth);
    toast.success("SMTP configuration removed");
    configQuery.refetch();
  };

  const templateColumns = [
    { id: "type", header: "Template", sortValue: (t) => t.type, cell: (t) => <EntityCell title={t.type} /> },
    { id: "updated", header: "Last changed", className: "text-ink-muted", sortValue: (t) => (t.updatedAt ? new Date(t.updatedAt).getTime() : 0), cell: (t) => timeAgo(t.updatedAt, "—") },
  ];

  return (
    <Page variant="settings">
      <PageHeader
        title="SMTP"
        description="Outbound email settings. Used for every ticket notification and reply."
        actions={
          state?.configured ? (
            <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset SMTP
            </Button>
          ) : null
        }
      />

      {configQuery.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : configQuery.isError ? (
        <Alert tone="danger" title="We couldn't load the SMTP settings" action={<Button size="sm" onClick={() => configQuery.refetch()}>Try again</Button>}>
          {configQuery.error.message}
        </Alert>
      ) : !state.configured ? (
        <Setup onDone={() => configQuery.refetch()} />
      ) : (
        <>
          {state.verified ? (
            <Alert tone="success" title="SMTP is configured and working">
              The server accepted the saved credentials.
            </Alert>
          ) : (
            <Alert tone="danger" title="Authentication error">
              {state.verificationError?.message || "The SMTP server rejected the saved credentials."}
            </Alert>
          )}

          <Section title="Connection">
            <dl className="-my-2 divide-y divide-line">
              <Detail label="Host">{state.config?.host || "—"}</Detail>
              <Detail label="Port">{state.config?.port ?? "—"}</Detail>
              <Detail label="Username">{state.config?.user || "—"}</Detail>
              <Detail label="Reply-to">{state.config?.reply || "—"}</Detail>
              {!state.verified ? (
                <>
                  <Detail label="Error code">{state.verificationError?.code || "N/A"}</Detail>
                  <Detail label="Response">{state.verificationError?.response || "N/A"}</Detail>
                  <Detail label="Response code">{state.verificationError?.responseCode || "N/A"}</Detail>
                </>
              ) : null}
            </dl>
          </Section>

          {state.verified ? (
            <Section title="Email templates" description="Messages the system sends for ticket events.">
              <div className="flex min-h-0 flex-col gap-3">
                <DataTable
                  label="Email templates"
                  columns={templateColumns}
                  rows={templatesQuery.data || []}
                  getRowId={(t) => t._id || t.id}
                  loading={templatesQuery.isPending}
                  error={templatesQuery.isError ? templatesQuery.error : null}
                  onRetry={() => templatesQuery.refetch()}
                  onRowClick={(t) => navigate(`/admin/smtp/templates/${t._id || t.id}`)}
                  rowActions={(t) => (
                    <Tooltip content="Edit template">
                      <Button variant="ghost" size="sm" icon aria-label={`Edit ${t.type} template`} onClick={() => navigate(`/admin/smtp/templates/${t._id || t.id}`)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </Tooltip>
                  )}
                  empty={<EmptyState icon={FileText} title="No templates found" description="Templates are created by the server the first time they are needed." />}
                />
              </div>
            </Section>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Reset SMTP settings?"
        description="The saved connection is deleted and outbound email stops until you configure it again."
        confirmLabel="Reset SMTP"
        onConfirm={remove}
      />
    </Page>
  );
}

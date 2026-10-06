// Admin > Email queues > New. The backend creates IMAP/SMTP (password) queues; Gmail OAuth queues are rejected by the API.
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, BackLink, Button, Field, FormActions, Input, Page, PageHeader, PasswordInput, Section, Select, toast } from "../../../ui";
import { useUser } from "../../../store/session";
import { createQueue, QUEUES_KEY } from "./api";

const EMPTY = { provider: "other", name: "", username: "", password: "", hostname: "", tls: "true", imapPort: "993", smtpPort: "465" };

export default function NewEmailQueue() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { fetchWithAuth } = useUser();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((current) => ({ ...current, [key]: e.target.value }));

  const gmail = form.provider === "gmail";
  const valid = !gmail && form.name.trim() && form.username.trim() && form.password && form.hostname.trim();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await createQueue(fetchWithAuth, {
        name: form.name.trim(),
        username: form.username.trim(),
        password: form.password,
        hostname: form.hostname.trim(),
        tls: form.tls === "true",
        serviceType: "other",
        imapPort: Number(form.imapPort) || 993,
        smtpPort: Number(form.smtpPort) || 465,
      });
      toast.success("Email queue created");
      queryClient.invalidateQueries({ queryKey: QUEUES_KEY });
      navigate("/admin/email-queues");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page variant="form">
      <BackLink to="/admin/email-queues">Email queues</BackLink>
      <PageHeader title="New email queue" description="Connect a mailbox so incoming email becomes tickets and replies can be sent." />

      <form onSubmit={submit} className="space-y-5">
        <Section title="Provider">
          <Field label="Email provider">
            {(f) => (
              <Select {...f} value={form.provider} onChange={set("provider")} disabled={busy}>
                <option value="other">IMAP / SMTP (username and password)</option>
                <option value="gmail">Google (OAuth)</option>
              </Select>
            )}
          </Field>
          {gmail ? (
            <Alert tone="warning" title="Google OAuth queues aren't available">
              The server currently accepts IMAP/SMTP queues only. Choose IMAP / SMTP and use an app password for Gmail accounts.
            </Alert>
          ) : null}
        </Section>

        {!gmail ? (
          <>
            <Section title="Account" description="Credentials are stored on the server and never shown again.">
              <Field label="Queue name" required>
                {(f) => <Input {...f} value={form.name} onChange={set("name")} placeholder="Support inbox" disabled={busy} required />}
              </Field>
              <Field label="Email address / username" required>
                {(f) => <Input {...f} type="email" value={form.username} onChange={set("username")} placeholder="support@company.com" autoComplete="off" disabled={busy} required />}
              </Field>
              <Field label="Password" required>
                {(f) => <PasswordInput {...f} value={form.password} onChange={set("password")} autoComplete="new-password" disabled={busy} required />}
              </Field>
            </Section>

            <Section title="Server">
              <Field label="Hostname" required hint="For example imap.company.com">
                {(f) => <Input {...f} value={form.hostname} onChange={set("hostname")} placeholder="imap.company.com" disabled={busy} required />}
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Security">
                  {(f) => (
                    <Select {...f} value={form.tls} onChange={set("tls")} disabled={busy}>
                      <option value="true">TLS (recommended)</option>
                      <option value="false">None</option>
                    </Select>
                  )}
                </Field>
                <Field label="IMAP port">{(f) => <Input {...f} inputMode="numeric" value={form.imapPort} onChange={set("imapPort")} disabled={busy} />}</Field>
                <Field label="SMTP port">{(f) => <Input {...f} inputMode="numeric" value={form.smtpPort} onChange={set("smtpPort")} disabled={busy} />}</Field>
              </div>
            </Section>
          </>
        ) : null}

        <FormActions>
          <Button onClick={() => navigate("/admin/email-queues")} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
            Create queue
          </Button>
        </FormActions>
      </form>
    </Page>
  );
}

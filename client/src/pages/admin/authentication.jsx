// Admin > Authentication. Single sign-on (OIDC) configuration.
// API: GET /v1/config/authentication/check, POST /oidc/update, DELETE /delete.
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Trash2 } from "lucide-react";
import { useUser } from "../../store/session";
import { Alert, Badge, Button, ConfirmDialog, Field, FormActions, Input, Page, PageHeader, Section, Select, Skeleton, toast } from "../../ui";

const AUTH_KEY = ["adminAuthConfig"];
const BASE = "/v1/config/authentication";

async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

async function fetchState(fetchWithAuth) {
  const res = await fetchWithAuth(`${BASE}/check`);
  if (!res.ok) throw new Error(await readError(res, `Could not load authentication settings (${res.status})`));
  const data = await res.json();
  return data.success && data.sso ? { enabled: true, provider: data.provider || "" } : { enabled: false, provider: "" };
}

function OidcForm({ onDone }) {
  const { fetchWithAuth } = useUser();
  const [form, setForm] = useState({ issuer: "", clientId: "", redirectUri: `${window.location.origin}/auth/oidc` });
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((c) => ({ ...c, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetchWithAuth(`${BASE}/oidc/update`, {
        method: "POST",
        body: JSON.stringify({ issuer: form.issuer.trim(), redirectUri: form.redirectUri.trim(), clientId: form.clientId.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || data.message || "Failed to save settings");
      toast.success("Single sign-on settings saved");
      onDone();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Section title="OpenID Connect" description="Enter the details from your identity provider.">
        <Field label="Issuer URL" required hint="The provider's base URL, for example https://accounts.example.com">
          {(f) => <Input {...f} value={form.issuer} onChange={set("issuer")} placeholder="https://accounts.example.com" disabled={busy} required />}
        </Field>
        <Field label="Client ID" required>{(f) => <Input {...f} value={form.clientId} onChange={set("clientId")} autoComplete="off" disabled={busy} required />}</Field>
        <Field label="Redirect URI" required hint="Register this exact URL with your identity provider.">
          {(f) => <Input {...f} value={form.redirectUri} onChange={set("redirectUri")} disabled={busy} required />}
        </Field>
      </Section>
      <FormActions>
        <Button type="submit" variant="primary" loading={busy} disabled={!form.issuer.trim() || !form.clientId.trim() || !form.redirectUri.trim()}>
          Save settings
        </Button>
      </FormActions>
    </form>
  );
}

export default function Authentication() {
  const { fetchWithAuth } = useUser();
  const [provider, setProvider] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const query = useQuery({ queryKey: AUTH_KEY, queryFn: () => fetchState(fetchWithAuth), staleTime: 0, retry: false });

  const remove = async () => {
    const res = await fetchWithAuth(`${BASE}/delete`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || data.message || "Failed to delete settings");
    toast.success("Single sign-on settings deleted");
    setProvider("");
    query.refetch();
  };

  return (
    <Page variant="settings">
      <PageHeader title="Authentication" description="How people sign in. Email and password always works; single sign-on is optional." />

      {query.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : query.isError ? (
        <Alert tone="danger" title="We couldn't load the authentication settings" action={<Button size="sm" onClick={() => query.refetch()}>Try again</Button>}>
          {query.error.message}
        </Alert>
      ) : query.data.enabled ? (
        <Section
          title={`Single sign-on: ${query.data.provider.toUpperCase() || "configured"}`}
          description="People see a single sign-on button on the login page."
          actions={<Badge tone="success" dot>Enabled</Badge>}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-body-sm text-ink-muted">Deleting the configuration turns single sign-on off. People can still sign in with email and password.</p>
            <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </Section>
      ) : (
        <>
          <Section title="Single sign-on" description="Not configured.">
            <Field label="Provider">
              {(f) => (
                <Select {...f} value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="" disabled>Select a provider</option>
                  <option value="oidc">OpenID Connect (OIDC)</option>
                  <option value="oauth" disabled>OAuth (not available yet)</option>
                  <option value="saml" disabled>SAML (not available yet)</option>
                </Select>
              )}
            </Field>
            {!provider ? (
              <p className="flex items-center gap-2 text-body-sm text-ink-muted">
                <KeyRound className="h-4 w-4" aria-hidden="true" /> Choose a provider to continue.
              </p>
            ) : null}
          </Section>
          {provider === "oidc" ? <OidcForm onDone={() => query.refetch()} /> : null}
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete single sign-on settings?"
        description="This turns single sign-on off. You will need to enter the provider details again to re-enable it."
        confirmLabel="Delete settings"
        onConfirm={remove}
      />
    </Page>
  );
}

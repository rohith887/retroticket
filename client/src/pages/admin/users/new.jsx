// Admin > Users > New. Uses POST /v1/user/new (the legacy page called a route that does not exist).
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BackLink, Button, Checkbox, Field, FormActions, Input, Page, PageHeader, PasswordInput, Section, toast } from "../../../ui";
import { useUser } from "../../../store/session";
import { readError, USERS_KEY } from "./api";

export default function NewUser() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { fetchWithAuth } = useUser();
  const [form, setForm] = useState({ name: "", email: "", password: "", admin: false });
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((c) => ({ ...c, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetchWithAuth("/v1/user/new", {
        method: "POST",
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), password: form.password, admin: form.admin }),
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to create user"));
      const data = await res.json();
      if (data.success === false) throw new Error(data.message || data.error || "Failed to create user");
      toast.success("User created");
      queryClient.invalidateQueries({ queryKey: USERS_KEY });
      navigate("/admin/users");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page variant="form">
      <BackLink to="/admin/users">Users</BackLink>
      <PageHeader title="New user" description="Create an account. They can change the password after signing in." />
      <form onSubmit={submit} className="space-y-5">
        <Section title="Account">
          <Field label="Full name" required>{(f) => <Input {...f} value={form.name} onChange={set("name")} placeholder="Priya Sharma" maxLength={120} disabled={busy} required />}</Field>
          <Field label="Email address" required>{(f) => <Input {...f} type="email" value={form.email} onChange={set("email")} placeholder="priya@company.com" autoComplete="off" disabled={busy} required />}</Field>
          <Field label="Temporary password" required hint="At least 8 characters.">
            {(f) => <PasswordInput {...f} value={form.password} onChange={set("password")} autoComplete="new-password" minLength={8} disabled={busy} required />}
          </Field>
        </Section>
        <Section title="Access">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox checked={form.admin} onChange={(e) => setForm((c) => ({ ...c, admin: e.target.checked }))} label="Administrator" disabled={busy} className="mt-0.5" />
            <span>
              <span className="block text-body-sm font-medium text-ink">Administrator</span>
              <span className="block text-caption text-ink-faint">Full access to every setting and record. Assign roles later from the Users list.</span>
            </span>
          </label>
        </Section>
        <FormActions>
          <Button onClick={() => navigate("/admin/users")} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!form.name.trim() || !form.email.trim() || form.password.length < 8}>
            Create user
          </Button>
        </FormActions>
      </form>
    </Page>
  );
}

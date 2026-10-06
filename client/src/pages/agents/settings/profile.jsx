import React, { useEffect, useState } from "react";
import { Button, Detail, Field, Input, PasswordInput, Section, Select, toast } from "../../../ui";
import { useUser } from "../../../store/session";
import { changePassword, updateProfile } from "./api";

// Locales the legacy interface shipped translations for.
const LANGUAGES = [
  ["en", "English"], ["de", "Deutsch"], ["es", "Español"], ["fr", "Français"], ["it", "Italiano"], ["pt", "Português"],
  ["da", "Dansk"], ["no", "Norsk"], ["se", "Svenska"], ["hu", "Magyar"], ["is", "Íslenska"], ["tr", "Türkçe"],
  ["he", "עברית"], ["th", "ไทย"], ["tl", "Tagalog"], ["zh-CN", "简体中文"],
];

function ProfileSection() {
  const { user, fetchWithAuth, refreshSession } = useUser();
  const [name, setName] = useState(user?.name || "");
  const [language, setLanguage] = useState(user?.language || "en");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
    setLanguage(user?.language || "en");
  }, [user?.name, user?.language]);

  const dirty = name.trim() !== (user?.name || "") || language !== (user?.language || "en");

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateProfile(fetchWithAuth, { name: name.trim(), language });
      await refreshSession();
      toast.success("Profile saved");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <Section
        title="Profile"
        description="How you appear to teammates."
        actions={
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!dirty || !name.trim()}>
            Save changes
          </Button>
        }
      >
        <Field label="Full name" required>{(f) => <Input {...f} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={busy} required />}</Field>
        <Field label="Language">
          {(f) => (
            <Select {...f} value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </Select>
          )}
        </Field>
        <dl className="-mb-2 divide-y divide-line border-t border-line">
          <Detail label="Email">{user?.email}</Detail>
          <Detail label="Roles">{user?.isAdmin ? "Administrator" : (user?.roles || []).join(", ") || "No role assigned"}</Detail>
        </dl>
      </Section>
    </form>
  );
}

function PasswordSection() {
  const { fetchWithAuth } = useUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = current && next.length >= 8 && next === confirm;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await changePassword(fetchWithAuth, current, next);
      toast.success("Password changed. Your other sessions were signed out.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Section
        title="Password"
        description="Changing your password signs you out of every other device."
        actions={
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!valid}>
            Change password
          </Button>
        }
      >
        <Field label="Current password" required>{(f) => <PasswordInput {...f} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" disabled={busy} />}</Field>
        <Field label="New password" required hint="At least 8 characters.">{(f) => <PasswordInput {...f} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} disabled={busy} />}</Field>
        <Field label="Confirm new password" required error={mismatch ? "The passwords do not match." : undefined}>
          {(f) => <PasswordInput {...f} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" disabled={busy} />}
        </Field>
      </Section>
    </form>
  );
}

export default function ProfileSettings() {
  return (
    <>
      <ProfileSection />
      <PasswordSection />
    </>
  );
}

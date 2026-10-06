// Shared composer (Tickets and Threads): one textarea, Reply / Internal note tabs.
//
// onSubmit({ mode: "reply" | "internal", body, email }) must return a promise; the composer clears itself when it
// resolves and stays filled when it rejects (the caller shows the error).
//   reply.to        display address for the reply (null when unknown); reply.label overrides the "To …" text
//   reply.askEmail  true when there is no address on file, so a recipient field is shown
//   internal        { enabled, askEmail, hint } - set enabled=false to hide the Internal note tab
//   seed            { key, text } - put text in the box when key changes (used to insert an AI draft; the agent can edit it freely)
//   onTextChange    called with the current text, so a parent can tell whether the box is empty
import React, { useEffect, useState } from "react";
import { Lock, Send } from "lucide-react";
import { Button, Input, Tabs, Textarea } from "../../ui";

export function MessageComposer({ onSubmit, reply = {}, internal = {}, disabled = false, seed = null, onTextChange }) {
  const [mode, setMode] = useState("reply");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!seed) return;
    setMode("reply");
    setBody(seed.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.key]);
  useEffect(() => {
    onTextChange?.(body);
  }, [body]); // eslint-disable-line react-hooks/exhaustive-deps

  const internalEnabled = internal.enabled !== false;
  const isInternal = mode === "internal" && internalEnabled;
  const askEmail = isInternal ? Boolean(internal.askEmail) : Boolean(reply.askEmail);
  const ready = body.trim() && (!askEmail || email.trim());

  async function submit(e) {
    e?.preventDefault();
    if (!ready || busy || disabled) return;
    setBusy(true);
    try {
      await onSubmit({ mode: isInternal ? "internal" : "reply", body: body.trim(), email: email.trim() });
      setBody("");
    } catch {
      /* the caller reports the error; keep the draft */
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="shrink-0 border-t border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Tabs
          idBase="composer"
          variant="segmented"
          label="Message type"
          value={isInternal ? "internal" : "reply"}
          onValueChange={setMode}
          items={[{ value: "reply", label: "Reply" }, ...(internalEnabled ? [{ value: "internal", label: "Internal note" }] : [])]}
        />
        {isInternal ? (
          <span className="inline-flex items-center gap-1 text-caption text-warning-ink"><Lock className="h-3 w-3" aria-hidden="true" /> {internal.hint || "Only visible to your team"}</span>
        ) : reply.label || reply.to ? (
          <span className="min-w-0 truncate text-caption text-ink-muted">{reply.label || `To ${reply.to}`}</span>
        ) : null}
      </div>
      {askEmail ? (
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={isInternal ? "Recipient email" : "Recipient email (none on file)"}
          aria-label="Recipient email"
          className="mb-2"
        />
      ) : null}
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(e);
        }}
        rows={3}
        placeholder={isInternal ? "Write an internal note…" : "Write a reply…"}
        aria-label={isInternal ? "Internal note" : "Reply"}
        disabled={busy || disabled}
        className={isInternal ? "border-warning bg-warning-soft" : undefined}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-caption text-ink-faint">Ctrl + Enter to send</span>
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!ready || disabled}>
          <Send className="h-3.5 w-3.5" /> {isInternal ? "Add note" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}

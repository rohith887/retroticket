import React, { useEffect, useState } from "react";
import { Button, Field, Section, Textarea, toast } from "../../../ui";
import { useUser } from "../../../store/session";
import { updateProfile } from "./api";

const MAX = 2000;

export default function SignatureSettings() {
  const { user, fetchWithAuth, refreshSession } = useUser();
  const [signature, setSignature] = useState(user?.signature || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => setSignature(user?.signature || ""), [user?.signature]);

  const dirty = signature !== (user?.signature || "");

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateProfile(fetchWithAuth, { signature });
      await refreshSession();
      toast.success("Signature saved");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <Section
        title="Reply signature"
        description="Saved with your profile. Plain text."
        actions={
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!dirty}>
            Save changes
          </Button>
        }
      >
        <Field label="Signature" hint={`${signature.length} / ${MAX} characters`}>
          {(f) => <Textarea {...f} value={signature} onChange={(e) => setSignature(e.target.value.slice(0, MAX))} rows={6} placeholder={"Best regards,\nYour name\nSupport team"} disabled={busy} />}
        </Field>
      </Section>
      <Section title="Preview">
        {signature.trim() ? (
          <p className="whitespace-pre-wrap text-body-sm text-ink">{signature}</p>
        ) : (
          <p className="text-body-sm text-ink-faint">Your signature will appear here.</p>
        )}
      </Section>
    </form>
  );
}

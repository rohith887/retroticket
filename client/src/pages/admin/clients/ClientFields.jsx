import React from "react";
import { Field, Input } from "../../../ui";

export const EMPTY_CLIENT = { name: "", email: "", contactName: "", number: "" };

/** Shared by the "New client" page and the edit drawer. All four fields are required (as before). */
export function ClientFields({ value, onChange, disabled }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="space-y-4">
      <Field label="Client name" required>
        {(f) => <Input {...f} value={value.name} onChange={set("name")} placeholder="Acme Verification Ltd" disabled={disabled} required />}
      </Field>
      <Field label="Email" required>
        {(f) => <Input {...f} type="email" value={value.email} onChange={set("email")} placeholder="accounts@acme.com" disabled={disabled} required />}
      </Field>
      <Field label="Primary contact name" required>
        {(f) => <Input {...f} value={value.contactName} onChange={set("contactName")} placeholder="Priya Sharma" disabled={disabled} required />}
      </Field>
      <Field label="Primary contact number" required>
        {(f) => <Input {...f} value={value.number} onChange={set("number")} placeholder="+91 98765 43210" disabled={disabled} required />}
      </Field>
    </div>
  );
}

export const isClientValid = (client) => Boolean(client.name.trim() && client.email.trim() && client.contactName.trim() && String(client.number).trim());

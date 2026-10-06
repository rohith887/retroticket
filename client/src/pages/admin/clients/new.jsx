// Admin > Clients > New. Same endpoint and required fields as before; presented as a form page.
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BackLink, Button, FormActions, Page, PageHeader, Section, toast } from "../../../ui";
import { useUser } from "../../../store/session";
import { CLIENTS_KEY, createClient } from "./api";
import { ClientFields, EMPTY_CLIENT, isClientValid } from "./ClientFields";

export default function NewClient() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { fetchWithAuth } = useUser();
  const [client, setClient] = useState(EMPTY_CLIENT);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await createClient(fetchWithAuth, { ...client, name: client.name.trim(), email: client.email.trim(), contactName: client.contactName.trim(), number: String(client.number).trim() });
      toast.success("Client created");
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
      navigate("/admin/clients");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page variant="form">
      <BackLink to="/admin/clients">Clients</BackLink>
      <PageHeader title="New client" description="Register a client organisation and its primary contact." />
      <form onSubmit={submit} className="space-y-5">
        <Section title="Client details" description="All fields are required.">
          <ClientFields value={client} onChange={setClient} disabled={busy} />
        </Section>
        <FormActions>
          <Button onClick={() => navigate("/admin/clients")} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!isClientValid(client)}>
            Create client
          </Button>
        </FormActions>
      </form>
    </Page>
  );
}

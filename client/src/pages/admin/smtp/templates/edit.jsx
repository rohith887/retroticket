// Admin > SMTP > Template editor (route /admin/smtp/templates/:id).
// GET /v1/ticket/template/:id, PUT /v1/ticket/template/:id { html }.
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { BackLink, Button, EmptyState, Field, FormActions, Page, PageHeader, Section, Skeleton, Textarea, toast } from "../../../../ui";
import { useUser } from "../../../../store/session";
import { fetchTemplate, saveTemplate, TEMPLATES_KEY } from "../api";

export default function EditTemplate() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { fetchWithAuth } = useUser();
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);

  const query = useQuery({ queryKey: ["adminEmailTemplate", id], queryFn: () => fetchTemplate(fetchWithAuth, id), staleTime: 0, retry: false });

  useEffect(() => {
    if (query.data) setHtml(query.data.html || "");
  }, [query.data]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await saveTemplate(fetchWithAuth, id, html);
      toast.success("Template saved");
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
      queryClient.invalidateQueries({ queryKey: ["adminEmailTemplate", id] });
      navigate("/admin/smtp");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page variant="settings">
      <BackLink to="/admin/smtp">SMTP</BackLink>
      <PageHeader title={query.data ? `${query.data.type} template` : "Email template"} description="HTML sent for this event. Handlebars placeholders such as {{title}} are filled in by the server." />

      {query.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : query.isError ? (
        <EmptyState icon={AlertTriangle} title="We couldn't load this template" description={query.error.message} action={<Button onClick={() => navigate("/admin/smtp")}>Back to SMTP</Button>} />
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <Section title="HTML">
            <Field label="Template HTML">
              {(f) => <Textarea {...f} value={html} onChange={(e) => setHtml(e.target.value)} rows={16} spellCheck={false} className="font-mono text-caption" disabled={busy} />}
            </Field>
          </Section>
          <Section title="Preview" description="Rendered in a sandbox: scripts do not run. Placeholders appear as written.">
            <iframe title="Template preview" sandbox="" srcDoc={html} className="h-72 w-full rounded-ds border border-line bg-white" />
          </Section>
          <FormActions>
            <Button onClick={() => navigate("/admin/smtp")} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={html === (query.data?.html || "")}>
              Save template
            </Button>
          </FormActions>
        </form>
      )}
    </Page>
  );
}

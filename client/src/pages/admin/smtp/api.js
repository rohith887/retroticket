// Data access for admin SMTP settings. Endpoints unchanged:
// GET/PUT/DELETE /v1/config/authentication/email, GET /v1/ticket/templates, GET/PUT /v1/ticket/template/:id

export const SMTP_KEY = ["adminSmtpConfig"];
export const TEMPLATES_KEY = ["adminEmailTemplates"];

async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchSmtpConfig(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/config/authentication/email");
  if (!res.ok) throw new Error(await readError(res, `Could not load email settings (${res.status})`));
  const data = await res.json();
  if (data.success && data.active) {
    // `verification === true` means the SMTP server accepted our credentials; otherwise it is the error object.
    return { configured: true, config: data.email, verified: data.verification === true, verificationError: data.verification === true ? null : data.verification };
  }
  return { configured: false, config: null, verified: false, verificationError: null };
}

export async function saveSmtpConfig(fetchWithAuth, body) {
  const res = await fetchWithAuth("/v1/config/authentication/email", { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await readError(res, "Failed to save configuration"));
  const data = await res.json();
  if (data.success === false) throw new Error(data.error || data.message || "Failed to save configuration");
  return data;
}

export async function deleteSmtpConfig(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/config/authentication/email", { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Failed to delete configuration"));
  const data = await res.json().catch(() => ({}));
  if (data.success === false) throw new Error(data.error || data.message || "Failed to delete configuration");
}

export async function fetchTemplates(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/ticket/templates");
  if (!res.ok) throw new Error(await readError(res, "Could not load email templates"));
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Could not load email templates");
  return data.templates || [];
}

export async function fetchTemplate(fetchWithAuth, id) {
  const res = await fetchWithAuth(`/v1/ticket/template/${id}`);
  if (!res.ok) throw new Error(await readError(res, "Template not found"));
  const data = await res.json();
  if (!data.success || !data.template) throw new Error("Template not found");
  return Array.isArray(data.template) ? data.template[0] : data.template;
}

export async function saveTemplate(fetchWithAuth, id, html) {
  const res = await fetchWithAuth(`/v1/ticket/template/${id}`, { method: "PUT", body: JSON.stringify({ html }) });
  if (!res.ok) throw new Error(await readError(res, "Failed to save template"));
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to save template");
}

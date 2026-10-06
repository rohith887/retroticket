// Data access for admin Clients. Endpoints are unchanged: /v1/client/{all,create,update,:id/delete-client}.

export const CLIENTS_KEY = ["fetchAllClients"];

async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchClients(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/client/all");
  if (!res.ok) throw new Error(await readError(res, `Could not load clients (${res.status})`));
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Could not load clients");
  return data.clients || [];
}

export async function createClient(fetchWithAuth, body) {
  const res = await fetchWithAuth("/v1/client/create", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await readError(res, "Failed to create client"));
  const data = await res.json();
  if (data.success !== true) throw new Error(data.error || "Failed to create client");
}

export async function updateClient(fetchWithAuth, id, body) {
  const res = await fetchWithAuth("/v1/client/update", { method: "POST", body: JSON.stringify({ ...body, id }) });
  if (!res.ok) throw new Error(await readError(res, "Failed to update client"));
  const data = await res.json();
  if (data.success === false) throw new Error(data.error || "Failed to update client");
}

export async function deleteClient(fetchWithAuth, id) {
  const res = await fetchWithAuth(`/v1/client/${id}/delete-client`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Failed to delete client"));
  const data = await res.json();
  if (data.success === false) throw new Error(data.error || "Failed to delete client");
}

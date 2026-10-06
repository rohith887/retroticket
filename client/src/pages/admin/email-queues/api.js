// Data access for admin Email Queues. Endpoints unchanged: GET /v1/email-queue/all, POST /create, DELETE /delete {id}.

export const QUEUES_KEY = ["adminQueues"];

async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchQueues(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/email-queue/all");
  if (!res.ok) throw new Error(await readError(res, `Could not load email queues (${res.status})`));
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Could not load email queues");
  return data.queues || [];
}

export async function createQueue(fetchWithAuth, body) {
  const res = await fetchWithAuth("/v1/email-queue/create", { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || data.error || "Failed to create email queue");
}

export async function deleteQueue(fetchWithAuth, id) {
  const res = await fetchWithAuth("/v1/email-queue/delete", { method: "DELETE", body: JSON.stringify({ id }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || data.error || "Failed to delete email queue");
}

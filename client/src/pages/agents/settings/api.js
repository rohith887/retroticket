// Data access for the agent Settings pages.
// PUT /v1/auth/profile, POST /v1/auth/password/change, PUT /v1/auth/profile/notifcations/emails (sic),
// GET /v1/auth/sessions, DELETE /v1/auth/sessions/:id

export const SESSIONS_KEY = ["mySessions"];

async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

export async function updateProfile(fetchWithAuth, body) {
  const res = await fetchWithAuth("/v1/auth/profile", { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await readError(res, "Failed to save profile"));
}

export async function changePassword(fetchWithAuth, currentPassword, newPassword) {
  const res = await fetchWithAuth("/v1/auth/password/change", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
  if (!res.ok) throw new Error(await readError(res, "Failed to change password"));
}

export async function updateNotifications(fetchWithAuth, prefs) {
  const res = await fetchWithAuth("/v1/auth/profile/notifcations/emails", { method: "PUT", body: JSON.stringify(prefs) });
  if (!res.ok) throw new Error(await readError(res, "Failed to save notification settings"));
}

export async function fetchSessions(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/auth/sessions");
  if (!res.ok) throw new Error(await readError(res, `Could not load sessions (${res.status})`));
  const data = await res.json();
  return data.sessions || [];
}

export async function revokeSession(fetchWithAuth, id) {
  const res = await fetchWithAuth(`/v1/auth/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Failed to sign that session out"));
}

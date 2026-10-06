// Data access for the admin Users screens (shared with the Overview setup checklist).

export const USERS_KEY = ["fetchAuthUsers"];
export const ROLES_KEY = ["fetchAuthRoles"];

export async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchUsers(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/user/all");
  if (!res.ok) throw new Error(await readError(res, `Could not load users (${res.status})`));
  const data = await res.json();
  if (data.success === false) throw new Error(data.error || "Could not load users");
  return data.users || [];
}

export async function fetchRoles(fetchWithAuth) {
  try {
    const res = await fetchWithAuth("/v1/role/all");
    if (!res.ok) return [];
    const data = await res.json();
    return data.roles || [];
  } catch {
    return [];
  }
}

export async function updateUser(fetchWithAuth, id, body) {
  const res = await fetchWithAuth(`/v1/user/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await readError(res, "Failed to update user"));
}

export async function resetPassword(fetchWithAuth, id, password) {
  const res = await fetchWithAuth("/v1/user/reset-password", { method: "PUT", body: JSON.stringify({ id, password }) });
  if (!res.ok) throw new Error(await readError(res, "Failed to reset password"));
}

export async function signOutEverywhere(fetchWithAuth, id) {
  const res = await fetchWithAuth(`/v1/auth/user/${id}/logout`);
  if (!res.ok) throw new Error(await readError(res, "Failed to sign the user out"));
}

export async function deleteUser(fetchWithAuth, id) {
  const res = await fetchWithAuth(`/v1/auth/user/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Failed to delete user"));
}

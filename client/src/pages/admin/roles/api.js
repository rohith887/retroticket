// Data access for admin Roles. Endpoints are unchanged: /v1/role/{all,create,:id,:id/update,:id/delete}
// and PATCH /v1/config/authentication/toggle-roles for the global enforcement switch.

export const ROLES_LIST_KEY = ["adminRolesFull"];

async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchRolesFull(fetchWithAuth) {
  const res = await fetchWithAuth("/v1/role/all");
  if (!res.ok) throw new Error(await readError(res, `Could not load roles (${res.status})`));
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Could not load roles");
  return { roles: data.roles || [], rolesActive: data.roles_active === true };
}

export async function fetchRole(fetchWithAuth, id) {
  const res = await fetchWithAuth(`/v1/role/${id}`);
  if (!res.ok) throw new Error(await readError(res, "Role not found"));
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Role not found");
  return data.role;
}

export async function createRole(fetchWithAuth, { name, description, permissions, userIds }) {
  const res = await fetchWithAuth("/v1/role/create", { method: "POST", body: JSON.stringify({ name, description, permissions }) });
  if (!res.ok) throw new Error(await readError(res, "Failed to create role"));
  const data = await res.json();
  if (!data.success) throw new Error(data.message || data.error || "Failed to create role");

  // The create endpoint does not accept members, so assign them with the update endpoint afterwards.
  if (userIds.length > 0) {
    const { roles } = await fetchRolesFull(fetchWithAuth);
    const created = roles.find((role) => role.name === name);
    if (!created) throw new Error("Role was created but members could not be assigned");
    await updateRole(fetchWithAuth, created._id, { name, description, permissions, userIds });
  }
}

export async function updateRole(fetchWithAuth, id, { name, description, permissions, userIds }) {
  const res = await fetchWithAuth(`/v1/role/${id}/update`, {
    method: "PUT",
    body: JSON.stringify({ name, description, permissions, users: userIds }),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to update role"));
  const data = await res.json();
  if (data.success === false) throw new Error(data.message || data.error || "Failed to update role");
}

export async function deleteRole(fetchWithAuth, id) {
  const res = await fetchWithAuth(`/v1/role/${id}/delete`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Failed to delete role"));
  const data = await res.json();
  if (data.success === false) throw new Error(data.error || "Failed to delete role");
}

export async function setRolesEnforced(fetchWithAuth, isActive) {
  const res = await fetchWithAuth("/v1/config/authentication/toggle-roles", { method: "PATCH", body: JSON.stringify({ isActive }) });
  if (!res.ok) throw new Error(await readError(res, "Failed to change role enforcement"));
  const data = await res.json();
  if (data.success === false) throw new Error(data.message || data.error || "Failed to change role enforcement");
}

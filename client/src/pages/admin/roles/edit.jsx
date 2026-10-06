// Admin > Roles > Edit (route /admin/roles/:id). Same form as "New role".
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { BackLink, Button, EmptyState, FormActions, Page, PageHeader, Skeleton, toast } from "../../../ui";
import { useUser } from "../../../store/session";
import { fetchRole, ROLES_LIST_KEY, updateRole } from "./api";
import { RoleForm } from "./RoleForm";
import { ROLES_KEY } from "../users/api";

export default function EditRole() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { fetchWithAuth } = useUser();
  const [role, setRole] = useState(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({ queryKey: ["adminRole", id], queryFn: () => fetchRole(fetchWithAuth, id), staleTime: 0, retry: false });

  useEffect(() => {
    if (query.data) {
      setRole({
        name: query.data.name || "",
        description: query.data.description || "",
        permissions: query.data.permissions || [],
        userIds: (query.data.users || []).map((u) => String(u._id || u)),
      });
    }
  }, [query.data]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateRole(fetchWithAuth, id, { ...role, name: role.name.trim(), description: role.description.trim() });
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ROLES_LIST_KEY });
      queryClient.invalidateQueries({ queryKey: ROLES_KEY });
      queryClient.invalidateQueries({ queryKey: ["adminRole", id] });
      navigate("/admin/roles");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page variant="editor">
      <BackLink to="/admin/roles">Roles</BackLink>
      <PageHeader title={query.data ? `Edit ${query.data.name}` : "Edit role"} description="Changes apply the next time each member's request is checked." />
      {query.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : query.isError ? (
        <EmptyState icon={AlertTriangle} title="We couldn't load this role" description={query.error.message} action={<Button onClick={() => navigate("/admin/roles")}>Back to roles</Button>} />
      ) : role ? (
        <form onSubmit={submit} className="space-y-3">
          <RoleForm value={role} onChange={setRole} disabled={busy} />
          <FormActions>
            <Button onClick={() => navigate("/admin/roles")} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!role.name.trim()}>
              Save changes
            </Button>
          </FormActions>
        </form>
      ) : null}
    </Page>
  );
}

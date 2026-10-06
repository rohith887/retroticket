// Admin > Roles > New. Single page (was a two-step wizard): details, permissions, members.
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BackLink, Button, FormActions, Page, PageHeader, toast } from "../../../ui";
import { useUser } from "../../../store/session";
import { createRole, ROLES_LIST_KEY } from "./api";
import { EMPTY_ROLE, RoleForm } from "./RoleForm";
import { ROLES_KEY } from "../users/api";

export default function NewRole() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { fetchWithAuth } = useUser();
  const [role, setRole] = useState(EMPTY_ROLE);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await createRole(fetchWithAuth, { ...role, name: role.name.trim(), description: role.description.trim() });
      toast.success("Role created");
      queryClient.invalidateQueries({ queryKey: ROLES_LIST_KEY });
      queryClient.invalidateQueries({ queryKey: ROLES_KEY });
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
      <PageHeader title="Create role" description="Define what members with this role can access." />
      <form onSubmit={submit} className="space-y-3">
        <RoleForm value={role} onChange={setRole} disabled={busy} />
        <FormActions>
          <Button onClick={() => navigate("/admin/roles")} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!role.name.trim()}>
            Create role
          </Button>
        </FormActions>
      </form>
    </Page>
  );
}

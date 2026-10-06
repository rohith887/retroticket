// Permission catalogue for the role editor. Keys are the exact strings the API checks with requirePermission().
const crud = (prefix) => ["create", "read", "update", "delete", "manage"].map((a) => `${prefix}::${a}`);

export const PERMISSION_GROUPS = [
  {
    id: "issues",
    label: "Tickets",
    description: "Create, work on and assign tickets",
    permissions: ["issue::create", "issue::read", "issue::write", "issue::update", "issue::delete", "issue::assign", "issue::transfer", "issue::comment"],
  },
  { id: "users", label: "Users", description: "Manage workspace members", permissions: crud("user") },
  { id: "roles", label: "Roles", description: "Define access levels", permissions: crud("role") },
  { id: "teams", label: "Teams", description: "Organise agents", permissions: crud("team") },
  { id: "clients", label: "Clients", description: "Client organisations", permissions: crud("client") },
  { id: "documents", label: "Documents", description: "Notebook documents", permissions: crud("document") },
  { id: "kb", label: "Knowledge base", description: "Help articles", permissions: crud("kb") },
  { id: "time", label: "Time tracking", description: "Time entries on tickets", permissions: ["time_entry::create", "time_entry::read", "time_entry::update", "time_entry::delete"] },
  { id: "webhooks", label: "Webhooks", description: "Outbound event hooks", permissions: ["webhook::create", "webhook::read", "webhook::update", "webhook::delete", "webhook::manage"] },
  { id: "settings", label: "Settings", description: "System settings", permissions: ["settings::view", "settings::manage"] },
  { id: "integrations", label: "Integrations", description: "Email queues, mailboxes and connections", permissions: ["integration::manage"] },
  { id: "email_templates", label: "Email templates", description: "Notification templates", permissions: ["email_template::manage"] },
];

// Column order in the permission matrix. Only actions that exist in the catalogue are shown.
const ACTION_ORDER = ["create", "read", "view", "write", "update", "delete", "assign", "transfer", "comment", "manage"];
export const actionOf = (permission) => permission.split("::")[1];
export const ALL_ACTIONS = ACTION_ORDER.filter((action) => PERMISSION_GROUPS.some((g) => g.permissions.some((p) => actionOf(p) === action)));

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.permissions);

/** "issue::create" -> "Create", "time_entry::read" -> "Read", "integration::manage" -> "Manage" */
export function permissionLabel(permission) {
  const action = permission.split("::")[1] || permission;
  return action.charAt(0).toUpperCase() + action.slice(1).replace(/_/g, " ");
}

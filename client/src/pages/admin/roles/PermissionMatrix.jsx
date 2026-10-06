// Permission matrix for the role editor: one row per resource, one column per action.
// Data comes from PERMISSION_GROUPS (the exact keys the API checks); nothing here adds or removes a permission.
import React, { useMemo, useState } from "react";
import { BookOpen, Building2, Clock, FileText, Mail, Plug, Settings, ShieldCheck, Ticket, UserRound, Users, Webhook } from "lucide-react";
import { Button, Checkbox, EmptyState, SearchInput, cn } from "../../../ui";
import { ALL_ACTIONS, PERMISSION_GROUPS, actionOf, permissionLabel } from "./permissions";

const ICONS = {
  issues: Ticket, users: UserRound, roles: ShieldCheck, teams: Users, clients: Building2, documents: FileText,
  kb: BookOpen, time: Clock, webhooks: Webhook, settings: Settings, integrations: Plug, email_templates: Mail,
};

const actionLabel = (action) => permissionLabel(`x::${action}`);

/** Tri-state for a set of permission keys against the selection. */
function stateOf(keys, selected) {
  const on = keys.filter((k) => selected.has(k)).length;
  return { checked: keys.length > 0 && on === keys.length, indeterminate: on > 0 && on < keys.length };
}

export function PermissionMatrix({ value, onChange, disabled }) {
  const [search, setSearch] = useState("");
  const selected = useMemo(() => new Set(value), [value]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return PERMISSION_GROUPS;
    return PERMISSION_GROUPS.filter((g) => [g.label, g.description, ...g.permissions].some((v) => v.toLowerCase().includes(term)));
  }, [search]);

  const visibleKeys = useMemo(() => rows.flatMap((g) => g.permissions), [rows]);
  const columns = ALL_ACTIONS.filter((action) => rows.some((g) => g.permissions.some((p) => actionOf(p) === action)));

  function apply(keys, on) {
    const next = new Set(selected);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    onChange([...next]);
  }

  const toggleKeys = (keys) => apply(keys, !keys.every((k) => selected.has(k)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search permissions" aria-label="Search permissions" className="w-full sm:w-64" />
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => apply(visibleKeys, true)} disabled={disabled || rows.length === 0}>Select all</Button>
          <Button size="sm" onClick={() => apply(visibleKeys, false)} disabled={disabled || rows.length === 0}>Clear all</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No permissions match" description="Try a different search." className="py-8" />
      ) : (
        <div className="overflow-x-auto rounded-ds-lg border border-line">
          <table className="w-full min-w-[600px] border-separate border-spacing-0 text-body-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 border-b border-line bg-subtle px-3 py-2 text-left text-caption font-medium uppercase tracking-wide text-ink-muted">
                  Resource
                </th>
                {columns.map((action) => {
                  const keys = rows.flatMap((g) => g.permissions.filter((p) => actionOf(p) === action));
                  return (
                    <th key={action} scope="col" className="w-[4.5rem] border-b border-line bg-subtle px-1 py-2 text-center">
                      <label className="flex cursor-pointer flex-col items-center gap-1 text-caption font-medium uppercase tracking-wide text-ink-muted">
                        {actionLabel(action)}
                        <Checkbox {...stateOf(keys, selected)} onChange={() => toggleKeys(keys)} disabled={disabled} label={`Toggle ${actionLabel(action)} for all shown resources`} />
                      </label>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((group) => {
                const Icon = ICONS[group.id] || Settings;
                const count = group.permissions.filter((p) => selected.has(p)).length;
                return (
                  <tr key={group.id} className="group">
                    <th scope="row" className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-1.5 text-left font-normal group-hover:bg-subtle">
                      <div className="flex items-center gap-3">
                        <Checkbox {...stateOf(group.permissions, selected)} onChange={() => toggleKeys(group.permissions)} disabled={disabled} label={`Select all ${group.label} permissions`} />
                        <Icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-medium text-ink">
                            {group.label}
                            {count > 0 ? (
                              <span className="text-caption font-normal text-ink-faint">
                                {count}/{group.permissions.length}
                              </span>
                            ) : null}
                          </div>
                          <div className="truncate text-caption text-ink-faint">{group.description}</div>
                        </div>
                      </div>
                    </th>
                    {columns.map((action) => {
                      const key = group.permissions.find((p) => actionOf(p) === action);
                      return (
                        <td key={action} className={cn("border-b border-line px-1 py-1.5 text-center group-hover:bg-subtle", key && selected.has(key) && "bg-brand-soft")}>
                          {key ? (
                            <Checkbox checked={selected.has(key)} onChange={() => toggleKeys([key])} disabled={disabled} label={`${group.label}: ${permissionLabel(key)}`} />
                          ) : (
                            <span className="text-ink-faint" aria-hidden="true">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

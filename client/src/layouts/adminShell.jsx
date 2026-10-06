// Admin layout built on the design-system shell. Replaces the legacy AdminLayout (adminLayout.jsx, now unused).
import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppShell } from "../ui/shell/AppShell";

// Every admin page now renders on the design system and owns its own padding and scrolling (see <Page>).
// Messages is the agent-side workspace and still use their legacy markup until that
// workspace is redesigned; they are hosted in a plain bordered container so they sit acceptably in the new shell.
const LEGACY_PATHS = ["/admin/messages"];

export default function AdminShell() {
  const { pathname } = useLocation();
  const legacy = LEGACY_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  return (
    <AppShell>
      {!legacy ? (
        <Outlet />
      ) : (
        <div className="p-4 md:p-6">
          <div className="rounded-ds-lg border border-line bg-surface p-4 md:p-6">
            <Outlet />
          </div>
        </div>
      )}
    </AppShell>
  );
}

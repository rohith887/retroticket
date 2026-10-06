// Agent portal layout: the shared shell with the mail-style sidebar.
// Settings pages are built on the design system; the ticket, thread and message pages are still legacy markup
// (their redesign is a later phase) and are hosted in a plain bordered container.
import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppShell } from "../ui/shell/AppShell";
import { portalBase } from "../ui/shell/nav";

export default function AgentShell() {
  const { pathname: fullPath } = useLocation();
  const base = portalBase(fullPath);
  const pathname = fullPath.replace(/^\/portal/, "/agents");
  // Pages built on the design system own their layout; the rest are legacy markup hosted in a bordered container.
  const native =
    pathname.startsWith("/agents/settings") ||
    pathname === "/agents/threads" ||
    (pathname.startsWith("/agents/tickets") && !/^\/agents\/tickets\/(new|search)\/?$/.test(pathname));

  return (
    <AppShell variant={base === "/portal" ? "moderator" : "agent"}>
      {native ? (
        <Outlet />
      ) : (
        <div className="p-3 md:p-4">
          <div className="rounded-ds-lg border border-line bg-surface p-3 md:p-4">
            <Outlet />
          </div>
        </div>
      )}
    </AppShell>
  );
}

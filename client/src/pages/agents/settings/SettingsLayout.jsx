import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useBase } from "../../../components/tickets/useTicketBase";
import { Bell, MonitorSmartphone, PenLine, Palette, UserRound } from "lucide-react";
import { Page, PageHeader, cn, focusRing } from "../../../ui";

const SECTIONS = [
  { to: "", label: "Profile & password", icon: UserRound, end: true },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/signature", label: "Signature", icon: PenLine },
  { to: "/sessions", label: "Sessions", icon: MonitorSmartphone },
  { to: "/appearance", label: "Appearance", icon: Palette },
];

/** Settings shell: a section list on the left (a scrolling row on small screens) and the active section on the right. */
export default function SettingsLayout() {
  const base = useBase();
  return (
    <Page variant="wide">
      <PageHeader title="Settings" description="Your profile, notifications and sign-in security." />
      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:overflow-visible md:px-0">
          {SECTIONS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={`${base}/settings${to}`}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex h-8 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-ds px-2.5 text-body-sm font-medium transition-colors",
                  isActive ? "bg-brand-soft text-brand-ink" : "text-ink-muted hover:bg-subtle hover:text-ink",
                  focusRing
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 max-w-2xl space-y-5">
          <Outlet />
        </div>
      </div>
    </Page>
  );
}

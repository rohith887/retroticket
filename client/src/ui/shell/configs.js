import { Settings } from "lucide-react";
import { ALL_NAV_ITEMS, portalNav } from "./nav";

/**
 * Per-portal shell settings: command-palette pages, the primary "create" action, and the go-to shortcuts.
 * `goto` keys are pressed after "g" (for example "g" then "i").
 */
function mailConfig(base) {
  const nav = portalNav(base);
  const moderator = base === "/portal";
  return {
    settingsHref: nav.settings,
    paletteItems: [...nav.items, { label: "Settings", href: nav.settings, icon: Settings, section: "Account", keywords: "profile password notifications signature sessions" }],
    newAction: { label: "New ticket", to: `${base}/tickets/new`, permission: "issue::create" },
    ticketBase: `${base}/tickets`,
    createKey: "c",
    goto: {
      i: { to: `${base}/tickets?status=mine`, label: "My tickets" },
      u: { to: `${base}/tickets?status=unassigned`, label: "Unassigned" },
      a: { to: `${base}/tickets?status=all`, label: "All open" },
      t: { to: `${base}/threads`, label: moderator ? "Applications" : "Threads" },
      s: { to: nav.settings, label: "Settings" },
    },
  };
}

export const SHELL_CONFIGS = {
  admin: {
    settingsHref: null,
    paletteItems: ALL_NAV_ITEMS.map((item) => ({ label: item.label, href: item.href, icon: item.icon, section: item.section, keywords: item.keywords })),
    newAction: { label: "New user", to: "/admin/users/new" },
    createKey: null,
    goto: {
      h: { to: "/admin", label: "Overview" },
      u: { to: "/admin/users", label: "Users" },
      t: { to: "/admin/tickets", label: "Tickets" },
    },
  },
  agent: mailConfig("/agents"),
  moderator: mailConfig("/portal"),
};

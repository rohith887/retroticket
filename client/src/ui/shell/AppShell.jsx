import React, { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "../../store/session";
import { usePermissions } from "../../store/permissions";
import { Drawer, DrawerContent } from "../index";
import { BrandMark, NavList, Rail } from "./Rail";
import { MailNav, MailRail } from "./MailSidebar";
import { TopBar } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { SHELL_CONFIGS } from "./configs";
import { useTheme } from "./theme";

function useStoredFlag(key, initial = false) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });
  const toggle = useCallback(() => {
    setValue((current) => {
      const next = !current;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* preference just won't persist */
      }
      return next;
    });
  }, [key]);
  return [value, toggle];
}

/** Ticket counters shared by the sidebars and the Overview page (same query key, so it is one request). */
export function useAdminSummary() {
  const { fetchWithAuth } = useUser();
  return useQuery({
    queryKey: ["adminSummary"],
    queryFn: async () => {
      const res = await fetchWithAuth("/v1/data/summary");
      if (!res.ok) throw new Error(`Summary failed (${res.status})`);
      return res.json();
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

/** Mailboxes shown as labels in the agent sidebar. Hidden when the user's role cannot list them. */
function useMailboxLabels(enabled) {
  const { fetchWithAuth } = useUser();
  const query = useQuery({
    queryKey: ["agentMailboxLabels"],
    queryFn: async () => {
      const res = await fetchWithAuth("/v1/mailboxes?active=true");
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.mailboxes) ? data.mailboxes : [];
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return query.data || [];
}

/**
 * Application shell shared by the admin console and the agent portal.
 *  - variant "admin": 56px icon rail (hover/pinned expansion) + breadcrumbs
 *  - variants "agent" / "moderator": mail-style sidebar (compose, views with counts, mailbox labels, settings) + page title
 * Both share the top bar (search, notifications, help, account), the command palette, shortcuts and the mobile drawer.
 */
export function AppShell({ children, variant = "admin" }) {
  const config = SHELL_CONFIGS[variant];
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme, toggle: toggleTheme } = useTheme();
  const { can } = usePermissions();
  const [pinned, togglePinned] = useStoredFlag("ds-rail-pinned", true);
  const [collapsed, toggleCollapsed] = useStoredFlag("ds-mail-collapsed", false);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const summary = useAdminSummary();
  const mailboxes = useMailboxLabels(variant === "agent" && can("integration::manage"));
  const counts = { open: summary.data?.open || 0, unassigned: summary.data?.unassigned || 0, mine: summary.data?.mine || 0 };

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setNavOpen(false), [location.pathname, location.search]);

  // Global keyboard shortcuts
  useEffect(() => {
    let sequence = false;
    let timer;
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const target = event.target;
      const typing =
        target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.closest?.("[role=dialog]");
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (sequence) {
        sequence = false;
        const route = config.goto[event.key.toLowerCase()]?.to;
        if (route) navigate(route);
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (config.createKey && event.key.toLowerCase() === config.createKey && (!config.newAction.permission || can(config.newAction.permission))) {
        event.preventDefault();
        navigate(config.newAction.to);
      } else if (event.key.toLowerCase() === "g") {
        sequence = true;
        clearTimeout(timer);
        timer = setTimeout(() => {
          sequence = false;
        }, 900);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(timer);
    };
  }, [navigate, config, can]);

  return (
    <div className="ds-root flex h-dvh bg-canvas">
      <a
        href="#main-content"
        className="sr-only z-[80] rounded-ds bg-brand px-3 py-2 text-body-sm font-medium text-brand-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      {variant !== "admin" ? (
        <MailRail collapsed={collapsed} counts={counts} mailboxes={mailboxes} base={variant === "moderator" ? "/portal" : "/agents"} />
      ) : (
        <Rail pinned={pinned} onTogglePin={togglePinned} counts={counts} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          variant={variant}
          settingsHref={config.settingsHref}
          onOpenNav={() => setNavOpen(true)}
          onToggleSidebar={variant !== "admin" ? toggleCollapsed : togglePinned}
          onOpenPalette={() => setPaletteOpen(true)}
          onShowShortcuts={() => setShortcutsOpen(true)}
          theme={theme}
          onSelectTheme={setTheme}
        />
        <main id="main-content" tabIndex={-1} className="relative min-h-0 flex-1 overflow-auto focus:outline-none">
          {children}
        </main>
      </div>

      {/* Mobile / tablet navigation drawer */}
      <Drawer open={navOpen} onOpenChange={setNavOpen}>
        <DrawerContent side="left" title="Navigation" header={<BrandMark />}>
          <div className="flex h-full flex-col">
            {variant !== "admin" ? (
              <MailNav expanded counts={counts} mailboxes={mailboxes} base={variant === "moderator" ? "/portal" : "/agents"} onNavigate={() => setNavOpen(false)} />
            ) : (
              <NavList expanded counts={counts} onNavigate={() => setNavOpen(false)} />
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        config={config}
        theme={theme}
        onToggleTheme={toggleTheme}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} config={config} />
    </div>
  );
}

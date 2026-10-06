import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronRight, HelpCircle, Keyboard, LogOut, Menu as MenuIcon, Search, Settings } from "lucide-react";
import { useUser } from "../../store/session";
import { Avatar, Badge, Button, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tooltip } from "../index";
import { THEMES } from "./theme";
import { cn, focusRing } from "../cn";
import { timeAgo } from "../time";
import { agentTitle, buildBreadcrumbs } from "./nav";

export const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl";

function Breadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = buildBreadcrumbs(pathname);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-body-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className={cn("flex min-w-0 items-center gap-1", !last && "hidden sm:flex")}>
              {index > 0 ? <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-ink-faint sm:block" aria-hidden="true" /> : null}
              {crumb.href && !last ? (
                <Link to={crumb.href} className={cn("truncate rounded-ds-sm text-ink-muted hover:text-ink", focusRing)}>
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn("truncate", last ? "font-medium text-ink" : "text-ink-muted")}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function NotificationsMenu() {
  const { user, fetchWithAuth, refreshSession } = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const items = Array.isArray(user?.notifications) ? user.notifications : [];
  const unread = items.filter((item) => !item.read);
  const shown = items.slice(0, 8);

  async function openItem(item) {
    setOpen(false);
    if (!item.read) {
      try {
        await fetchWithAuth(`/v1/user/notification/${item._id || item.id}`);
        refreshSession?.();
      } catch {
        /* marking as read is best-effort */
      }
    }
    navigate(item.ticketId ? `/admin/tickets?ticketId=${item.ticketId}` : "/admin/tickets");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Notifications">
        <PopoverTrigger asChild>
          <Button variant="ghost" icon aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"} className="relative">
            <Bell className="h-4 w-4" />
            {unread.length ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand ring-2 ring-surface" aria-hidden="true" /> : null}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-body-sm font-semibold text-ink">Notifications</h2>
          {unread.length ? <Badge tone="brand">{unread.length} new</Badge> : null}
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-body-sm text-ink-muted">You're all caught up.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {shown.map((item) => (
              <li key={item._id || item.id}>
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className={cn("flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-subtle", focusRing)}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-brand")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-body-sm", item.read ? "text-ink-muted" : "font-medium text-ink")}>
                      {item.title || item.text || item.message}
                    </span>
                    <span className="block text-caption text-ink-faint">{timeAgo(item.createdAt, "")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function HelpMenu({ onShowShortcuts }) {
  return (
    <Menu>
      <Tooltip content="Help">
        <MenuTrigger asChild>
          <Button variant="ghost" icon aria-label="Help">
            <HelpCircle className="h-4 w-4" />
          </Button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent>
        <MenuLabel>Help</MenuLabel>
        <MenuItem icon={Keyboard} shortcut="?" onSelect={onShowShortcuts}>
          Keyboard shortcuts
        </MenuItem>
        <MenuSeparator />
        <div className="px-2 py-1.5 text-caption text-ink-faint">Version {import.meta.env.VITE_CLIENT_VERSION || "1.0.0"}</div>
      </MenuContent>
    </Menu>
  );
}

function UserMenu({ theme, onSelectTheme, onShowShortcuts, settingsHref }) {
  const { user, logout } = useUser();
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" aria-label="Account menu" className={cn("ml-1 rounded-full", focusRing)}>
          <Avatar name={user?.name || user?.email} size="sm" />
        </button>
      </MenuTrigger>
      <MenuContent className="w-60">
        <div className="px-2 py-2">
          <div className="truncate text-body-sm font-medium text-ink">{user?.name || "Account"}</div>
          <div className="truncate text-caption text-ink-faint">{user?.email}</div>
        </div>
        <MenuSeparator />
        {settingsHref ? (
          <MenuItem icon={Settings} onSelect={() => navigate(settingsHref)}>
            Settings
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={theme} onValueChange={onSelectTheme}>
          {THEMES.map((t) => (
            <MenuRadioItem key={t.id} value={t.id}>
              {t.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem icon={Keyboard} shortcut="?" onSelect={onShowShortcuts}>
          Keyboard shortcuts
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={LogOut}
          onSelect={() => {
            logout();
            navigate("/auth/login", { replace: true });
          }}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function AgentHeading() {
  const { pathname, search } = useLocation();
  return <h1 className="truncate text-title font-semibold text-ink">{agentTitle(pathname, search)}</h1>;
}

export function TopBar({ variant = "admin", settingsHref, onOpenNav, onToggleSidebar, onOpenPalette, onShowShortcuts, theme, onSelectTheme }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
      <Button variant="ghost" icon aria-label="Open navigation" onClick={onOpenNav} className="lg:hidden">
        <MenuIcon className="h-4 w-4" />
      </Button>
      {onToggleSidebar ? (
        <Tooltip content="Collapse or expand sidebar">
          <Button variant="ghost" icon aria-label="Collapse or expand sidebar" onClick={onToggleSidebar} className="hidden lg:inline-flex">
            <MenuIcon className="h-4 w-4" />
          </Button>
        </Tooltip>
      ) : null}

      <div className="min-w-0 flex-1">{variant !== "admin" ? <AgentHeading /> : <Breadcrumbs />}</div>

      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Search or jump to"
        className={cn(
          "hidden h-8 w-72 items-center gap-2 rounded-ds border border-line-strong bg-canvas px-2.5 text-body-sm text-ink-faint transition-colors hover:border-ink-faint md:flex",
          focusRing
        )}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>{modKey}</Kbd>
        <Kbd>K</Kbd>
      </button>
      <Button variant="ghost" icon aria-label="Search" onClick={onOpenPalette} className="md:hidden">
        <Search className="h-4 w-4" />
      </Button>

      <HelpMenu onShowShortcuts={onShowShortcuts} />
      <NotificationsMenu />
      <UserMenu theme={theme} onSelectTheme={onSelectTheme} onShowShortcuts={onShowShortcuts} settingsHref={settingsHref} />
    </header>
  );
}

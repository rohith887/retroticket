import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Pencil, Settings, Tag } from "lucide-react";
import { usePermissions } from "../../store/permissions";
import { useUser } from "../../store/session";
import { cn, focusRing } from "../cn";
import { Tooltip } from "../Overlays";
import { portalNav } from "./nav";
import { BrandMark } from "./Rail";

function MailItem({ to, icon: Icon, label, count, active, expanded, emphasise, onNavigate, dot }) {
  const hasCount = typeof count === "number" && count > 0;
  const link = (
    <Link
      to={to}
      onClick={(e) => {
        onNavigate?.(e);
        // Collapsing right away re-wraps this link in a Tooltip while it still holds focus from the click; blur it so
        // the tooltip doesn't open from that stale focus and land in the wrong place mid-animation.
        e.currentTarget.blur();
      }}
      aria-current={active ? "page" : undefined}
      aria-label={!expanded && hasCount ? `${label}, ${count}` : undefined}
      className={cn(
        "relative flex h-8 items-center gap-3 rounded-ds px-2.5 text-body-sm transition-colors",
        active ? "bg-brand-soft font-semibold text-brand-ink" : "font-medium text-ink-muted hover:bg-subtle hover:text-ink",
        focusRing
      )}
    >
      {dot ? <span aria-hidden="true" className={cn("mx-[3px] h-2.5 w-2.5 shrink-0 rounded-full border", active ? "border-brand bg-brand" : "border-ink-faint")} /> : <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="flex-1 truncate">{label}</span>
      {hasCount ? (
        expanded ? (
          <span className={cn("text-caption tabular-nums", emphasise || active ? "font-semibold text-ink" : "text-ink-faint")}>{count > 999 ? "999+" : count}</span>
        ) : emphasise ? (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
        ) : null
      ) : null}
    </Link>
  );
  return expanded ? link : <Tooltip content={label} side="right" delay={150}>{link}</Tooltip>;
}

function useCurrentView(base) {
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const status = params.get("status");
  return {
    pathname,
    folder: params.get("folder") || "inbox",
    mailboxId: params.get("mailboxId"),
    ticketView: pathname === `${base}/tickets` ? (!status || status === "open" ? "mine" : status) : null,
  };
}

/** Mail-style navigation: compose button, ticket views with counts, conversations, mailbox labels, settings. */
export function MailNav({ expanded, counts = {}, mailboxes = [], onNavigate, base = "/agents" }) {
  const { imap_enabled: imapEnabled } = useUser();
  const nav = portalNav(base);
  // The raw email folders only work when IMAP is configured (the legacy inbox redirects away otherwise).
  const emailItems = imapEnabled ? nav.email : [];
  const { can } = usePermissions();
  const { pathname, mailboxId, ticketView, folder } = useCurrentView(base);
  const canRead = can("issue::read");

  return (
    <nav aria-label={base === "/portal" ? "Moderator" : "Agent"} className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2 pb-2 pt-1">
      {can("issue::create") ? (
        <div className="px-0.5 pb-3 pt-1">
          <Tooltip content={expanded ? null : "New ticket"} side="right" delay={150}>
            <Link
              to={`${base}/tickets/new`}
              onClick={onNavigate}
              aria-label="New ticket"
              className={cn(
                "flex h-10 items-center rounded-full bg-brand text-body-sm font-medium text-brand-fg transition-colors hover:bg-brand-strong",
                expanded ? "gap-2 px-4" : "w-10 justify-center",
                focusRing
              )}
            >
              <Pencil className="h-4 w-4 shrink-0" aria-hidden="true" />
              {expanded ? <span>New ticket</span> : null}
            </Link>
          </Tooltip>
        </div>
      ) : null}

      {canRead ? (
        <ul className="space-y-0.5">
          {nav.views.map((view) => (
            <li key={view.id}>
              <MailItem
                to={view.to}
                icon={view.icon}
                label={view.label}
                count={view.countKey ? counts[view.countKey] : undefined}
                emphasise={view.emphasise}
                active={ticketView === view.id}
                expanded={expanded}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <div className={cn("my-3", expanded ? "mx-2 h-px bg-line" : "mx-2 h-px bg-line")} aria-hidden="true" />

      <ul className="space-y-0.5">
        {nav.conversations.map((item) => (
          <li key={item.id}>
            <MailItem
              to={item.to}
              icon={item.icon}
              label={item.label}
              active={pathname.startsWith(item.to) && !(item.id === "threads" && mailboxId)}
              expanded={expanded}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>

      {emailItems.length > 0 ? (
        <>
          {expanded ? (
            <div className="mt-4 px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Email</div>
          ) : (
            <div className="mx-2 my-3 h-px bg-line" aria-hidden="true" />
          )}
          <ul className="space-y-0.5">
            {emailItems.map((item) => (
              <li key={item.id}>
                <MailItem to={item.to} icon={item.icon} label={item.label} active={pathname === "/portal/inbox" && folder === item.id} expanded={expanded} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {mailboxes.length > 0 ? (
        <>
          {expanded ? (
            <div className="mt-4 px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Mailboxes</div>
          ) : (
            <div className="mx-2 my-3 h-px bg-line" aria-hidden="true" />
          )}
          <ul className="space-y-0.5">
            {mailboxes.map((mailbox) => (
              <li key={mailbox._id}>
                <MailItem
                  to={`${base}/threads?mailboxId=${mailbox._id}`}
                  icon={Tag}
                  dot
                  label={mailbox.name}
                  active={pathname.startsWith(`${base}/threads`) && mailboxId === mailbox._id}
                  expanded={expanded}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="mt-auto pt-3">
        <div className="mx-2 mb-2 h-px bg-line" aria-hidden="true" />
        <MailItem to={nav.settings} icon={Settings} label="Settings" active={pathname.startsWith(nav.settings)} expanded={expanded} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}

/**
 * Desktop sidebar. Expanded (256px) by default; the top-bar menu button collapses it to an icon rail.
 * While collapsed it expands over the content on hover or keyboard focus, like Gmail. Hidden below lg (see drawer).
 */
export function MailRail({ collapsed, counts, mailboxes, base }) {
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const expanded = !collapsed || hovered || focusWithin;

  // Picking a link snaps the hover-preview shut right away, instead of leaving it expanded over the page until the
  // pointer happens to move off it. When the sidebar isn't collapsed (pinned open) this is a no-op.
  function collapseAfterNavigate() {
    if (!collapsed) return;
    setHovered(false);
    setFocusWithin(false);
  }

  return (
    <aside
      className="relative hidden shrink-0 transition-[width] duration-150 lg:block"
      style={{ width: collapsed ? "var(--ds-rail-w)" : "16rem" }}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false);
        }}
        className={cn(
          "absolute inset-y-0 left-0 z-30 flex flex-col border-r border-line bg-surface transition-[width] duration-150",
          collapsed && expanded && "shadow-ds-popover"
        )}
        style={{ width: expanded ? "16rem" : "var(--ds-rail-w)" }}
      >
        <BrandMark expanded={expanded} />
        <MailNav expanded={expanded} counts={counts} mailboxes={mailboxes} base={base} onNavigate={collapseAfterNavigate} />
      </div>
    </aside>
  );
}

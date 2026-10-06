import React, { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, Pin, PinOff } from "lucide-react";
import { cn, focusRing } from "../cn";
import { Tooltip } from "../Overlays";
import { ADMIN_NAV } from "./nav";
import { BRAND_INITIAL, BRAND_NAME } from "../brand";

export function BrandMark({ expanded = true }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 px-3">
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-ds-lg bg-brand text-body-sm font-semibold text-brand-fg"
      >
        {BRAND_INITIAL}
      </span>
      <span className={cn("truncate text-body font-semibold text-ink transition-opacity", expanded ? "opacity-100" : "opacity-0")}>
        {BRAND_NAME}
      </span>
    </div>
  );
}

const GROUPS_KEY = "ds-nav-closed";

function readClosed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(GROUPS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function NavItem({ item, expanded, badge, onNavigate, nested }) {
  const link = (
    <NavLink
      to={item.href}
      end={item.end}
      onClick={(e) => {
        onNavigate?.(e);
        // Collapsing right away re-wraps this link in a Tooltip while it still holds focus from the click; blur it so
        // the tooltip doesn't open from that stale focus and land in the wrong place mid-animation.
        e.currentTarget.blur();
      }}
      className={({ isActive }) =>
        cn(
          "relative flex h-8 items-center gap-3 rounded-ds px-2.5 text-body-sm font-medium transition-colors",
          nested && "pl-3",
          focusRing,
          isActive ? "bg-brand-soft text-brand-ink" : "text-ink-muted hover:bg-subtle hover:text-ink"
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">{item.label}</span>
      {badge ? (
        expanded ? (
          <span className="rounded-full bg-subtle px-1.5 text-[11px] font-medium leading-4 text-ink-muted">{badge > 99 ? "99+" : badge}</span>
        ) : (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
        )
      ) : null}
    </NavLink>
  );
  // Collapsed rail: themed tooltip instead of the browser's native title bubble.
  return expanded ? link : <Tooltip content={item.label} side="right" delay={150}>{link}</Tooltip>;
}

/**
 * The nav groups; shared by the desktop rail and the mobile drawer.
 * Expanded: titled groups are accordions (open state remembered; the group holding the current page is always open).
 * Collapsed (icon rail): a flat list of icons separated by hairlines.
 */
export function NavList({ expanded, counts = {}, onNavigate }) {
  const { pathname } = useLocation();
  const [closed, setClosed] = useState(readClosed);

  function toggleGroup(title) {
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        /* preference just won't persist */
      }
      return next;
    });
  }

  return (
    <nav aria-label="Admin" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
      {ADMIN_NAV.map((group, index) => {
        const hasActive = group.items.some((item) => (item.end ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)));
        const accordion = expanded && group.title;
        const open = !accordion || hasActive || !closed.has(group.title);
        const listId = `nav-group-${(group.title || "top").toLowerCase()}`;
        return (
          <div key={group.title || "top"} className={cn(index > 0 && (accordion ? "mt-1" : "mt-3"))}>
            {accordion ? (
              <button
                type="button"
                onClick={() => toggleGroup(group.title)}
                aria-expanded={open}
                aria-controls={listId}
                className={cn(
                  "flex h-8 w-full items-center justify-between rounded-ds px-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint hover:bg-subtle hover:text-ink-muted",
                  focusRing
                )}
              >
                {group.title}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
              </button>
            ) : group.title ? (
              <div className="mx-2 mb-2 h-px bg-line" aria-hidden="true" />
            ) : null}
            {open ? (
              <ul id={listId} className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavItem item={item} expanded={expanded} badge={item.badgeKey ? counts[item.badgeKey] : null} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * 56px icon rail. Expands to 232px on hover or keyboard focus (overlaying the content) and can be pinned
 * open, in which case it pushes the content. Hidden below the lg breakpoint (see MobileNav).
 */
export function Rail({ pinned, onTogglePin, counts }) {
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const expanded = pinned || hovered || focusWithin;

  // Picking a link snaps the hover-preview shut right away, instead of leaving it expanded over the page until the
  // pointer happens to move off it. Pinned mode is unaffected: it is meant to stay open.
  function collapseAfterNavigate() {
    if (pinned) return;
    setHovered(false);
    setFocusWithin(false);
  }

  return (
    <aside
      className="relative hidden shrink-0 transition-[width] duration-150 lg:block"
      style={{ width: pinned ? "var(--ds-rail-w-expanded)" : "var(--ds-rail-w)" }}
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
          expanded && !pinned && "shadow-ds-popover"
        )}
        style={{ width: expanded ? "var(--ds-rail-w-expanded)" : "var(--ds-rail-w)" }}
      >
        <BrandMark expanded={expanded} />
        <NavList expanded={expanded} counts={counts} onNavigate={collapseAfterNavigate} />
        <div className="shrink-0 border-t border-line p-2">
          <Tooltip content={pinned ? "Unpin sidebar" : "Pin sidebar open"} side="right">
            <button
              type="button"
              onClick={onTogglePin}
              aria-pressed={pinned}
              aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"}
              className={cn(
                "flex h-8 w-full items-center gap-3 rounded-ds px-2.5 text-body-sm font-medium text-ink-muted hover:bg-subtle hover:text-ink",
                focusRing
              )}
            >
              {pinned ? <PinOff className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Pin className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span className="truncate">{pinned ? "Unpin" : "Pin open"}</span>
            </button>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}

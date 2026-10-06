import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { CornerDownLeft, Keyboard, Moon, Search, Sun, Ticket, UserPlus } from "lucide-react";
import { useUser } from "../../store/session";
import { usePermissions } from "../../store/permissions";
import { Kbd } from "../index";
import { cn } from "../cn";

const itemClass =
  "flex h-9 cursor-default select-none items-center gap-3 rounded-ds px-2.5 text-body-sm text-ink outline-none " +
  "data-[selected=true]:bg-subtle data-[selected=true]:text-ink";
const groupClass = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-faint";

/**
 * Global search / command palette (Cmd/Ctrl+K). Pages, actions and (for 2+ characters) live ticket search.
 * All navigation targets come from ADMIN_NAV so the palette can never drift from the sidebar.
 */
export function CommandPalette({ open, onOpenChange, config, theme, onToggleTheme, onShowShortcuts }) {
  const navigate = useNavigate();
  const { fetchWithAuth } = useUser();
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [tickets, setTickets] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setTickets([]);
    }
  }, [open]);

  // Debounced ticket search
  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 2) {
      setTickets([]);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetchWithAuth("/v1/ticket/tickets/search", {
          method: "POST",
          body: JSON.stringify({ query: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }),
        });
        const data = res.ok ? await res.json() : { tickets: [] };
        if (!cancelled) setTickets((data.tickets || []).slice(0, 6));
      } catch {
        if (!cancelled) setTickets([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, fetchWithAuth]);

  function run(action) {
    onOpenChange(false);
    // Let the dialog finish closing so focus is restored before navigating.
    setTimeout(action, 0);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-label="Command palette"
          className="ds-root fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-ds-lg border border-line bg-surface shadow-ds-dialog data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search pages, tickets and actions.</DialogPrimitive.Description>
          <Command label="Command palette" loop>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search tickets, jump to a page, run an action…"
                className="h-11 w-full border-0 bg-transparent p-0 text-body text-ink outline-none placeholder:text-ink-faint focus:border-0 focus:ring-0"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(24rem,60vh)] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-body-sm text-ink-muted">
                {searching ? "Searching…" : "No results found."}
              </Command.Empty>

              {tickets.length > 0 && (
                <Command.Group heading="Tickets" forceMount className={groupClass}>
                  {tickets.map((ticket) => (
                    <Command.Item
                      key={ticket._id}
                      forceMount
                      value={`ticket-${ticket._id}`}
                      onSelect={() => run(() => navigate(config.ticketBase ? `${config.ticketBase}/${ticket._id}` : `/admin/tickets?ticketId=${ticket._id}`))}
                      className={itemClass}
                    >
                      <Ticket className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
                      {ticket.number ? <span className="text-caption text-ink-faint">{ticket.number}</span> : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Go to" className={groupClass}>
                {config.paletteItems.map((item) => (
                  <Command.Item
                    key={item.href}
                    value={`${item.label} ${item.section || ""} ${item.keywords || ""}`}
                    onSelect={() => run(() => navigate(item.href))}
                    className={itemClass}
                  >
                    <item.icon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                    <span className="flex-1">{item.label}</span>
                    {item.section ? <span className="text-caption text-ink-faint">{item.section}</span> : null}
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Actions" className={groupClass}>
                {!config.newAction.permission || can(config.newAction.permission) ? (
                  <Command.Item value={`${config.newAction.label} create new add`} onSelect={() => run(() => navigate(config.newAction.to))} className={itemClass}>
                    <UserPlus className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                    <span className="flex-1">{config.newAction.label}</span>
                  </Command.Item>
                ) : null}
                <Command.Item value="toggle theme dark light appearance" onSelect={() => run(onToggleTheme)} className={itemClass}>
                  {theme === "dark" ? <Sun className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" /> : <Moon className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />}
                  <span className="flex-1">{theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}</span>
                </Command.Item>
                <Command.Item value="keyboard shortcuts help" onSelect={() => run(onShowShortcuts)} className={itemClass}>
                  <Keyboard className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
                  <span className="flex-1">Keyboard shortcuts</span>
                </Command.Item>
              </Command.Group>
            </Command.List>
            <div className={cn("flex items-center gap-4 border-t border-line px-3 py-2 text-caption text-ink-faint")}>
              <span className="inline-flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>
                  <CornerDownLeft className="h-3 w-3" />
                </Kbd>{" "}
                open
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

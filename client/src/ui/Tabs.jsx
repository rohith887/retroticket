import React, { useRef } from "react";
import { cn, focusRing } from "./cn";

/**
 * Accessible tabs (WAI-ARIA tablist): arrow keys, Home/End, roving tabindex.
 * Controlled: pass `value` and `onValueChange`. Render your own panel with `role="tabpanel"` and
 * `aria-labelledby={tabId(idBase, value)}` or use <TabPanel>.
 */
export const tabId = (base, value) => `${base}-tab-${value}`;
export const panelId = (base, value) => `${base}-panel-${value}`;

export function Tabs({ idBase, value, onValueChange, items, className, variant = "underline", label }) {
  const refs = useRef({});

  function onKeyDown(e) {
    const index = items.findIndex((item) => item.value === value);
    let next = null;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = items[next].value;
    onValueChange(target);
    refs.current[target]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(variant === "underline" ? "flex items-center gap-4 border-b border-line" : "inline-flex items-center gap-0.5 rounded-ds bg-subtle p-0.5", className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              refs.current[item.value] = node;
            }}
            id={tabId(idBase, item.value)}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={panelId(idBase, item.value)}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap text-body-sm font-medium transition-colors",
              focusRing,
              variant === "underline"
                ? cn("-mb-px h-9 border-b-2", active ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink")
                : cn("h-7 rounded-ds-sm px-2.5", active ? "bg-surface text-ink shadow-[0_0_0_1px_rgb(var(--ds-line))]" : "text-ink-muted hover:text-ink")
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className={cn("rounded-full px-1.5 text-[11px] leading-4", active ? "bg-brand-soft text-brand-ink" : "bg-subtle text-ink-muted")}>
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, value, active, className, children }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={panelId(idBase, value)} aria-labelledby={tabId(idBase, value)} tabIndex={0} className={cn(focusRing, className)}>
      {children}
    </div>
  );
}

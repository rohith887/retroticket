import React from "react";
import { ChevronDown, X } from "lucide-react";
import { cn, focusRing } from "./cn";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./Overlays";

/**
 * Single-select filter chip. `value === null` means "any" (chip is outlined); otherwise it is filled
 * and shows a clear button.
 */
export function FilterChip({ label, value, options, onChange, anyLabel = "Any" }) {
  const active = value !== null && value !== undefined;
  const current = options.find((option) => option.value === value);
  return (
    <span className="inline-flex items-center">
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 border px-2.5 text-caption font-medium transition-colors",
              active ? "rounded-l-ds border-brand-softline bg-brand-soft text-brand-ink" : "rounded-ds border-line-strong bg-surface text-ink-muted hover:bg-subtle hover:text-ink",
              focusRing
            )}
          >
            <span>{label}</span>
            {active ? <span className="font-semibold">{current?.label}</span> : null}
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuRadioGroup value={active ? String(value) : "__any"} onValueChange={(next) => onChange(next === "__any" ? null : next)}>
            <MenuRadioItem value="__any">{anyLabel}</MenuRadioItem>
            {options.map((option) => (
              <MenuRadioItem key={option.value} value={String(option.value)}>
                {option.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      {active ? (
        <button
          type="button"
          aria-label={`Clear ${label} filter`}
          onClick={() => onChange(null)}
          className={cn("inline-flex h-7 w-7 items-center justify-center rounded-r-ds border border-l-0 border-brand-softline bg-brand-soft text-brand-ink hover:bg-brand-softline", focusRing)}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}

/** Multi-select toggle pill (for picking several roles, tags, etc.). */
export function ToggleChip({ pressed, onClick, disabled, children }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center rounded-ds border px-2.5 text-caption font-medium transition-colors disabled:opacity-50",
        pressed ? "border-brand-softline bg-brand-soft text-brand-ink" : "border-line-strong bg-surface text-ink-muted hover:bg-subtle hover:text-ink",
        focusRing
      )}
    >
      {children}
    </button>
  );
}

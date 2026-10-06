import React, { useEffect, useId, useRef } from "react";
import { Check, ChevronDown, Minus, Search, X } from "lucide-react";
import { cn, focusRing } from "./cn";

const controlBase =
  "block w-full rounded-ds border border-line-strong bg-surface text-body-sm text-ink placeholder:text-ink-faint " +
  "transition-colors hover:border-ink-faint disabled:cursor-not-allowed disabled:bg-subtle disabled:opacity-70 " +
  "aria-[invalid=true]:border-danger focus:border-focus " +
  focusRing;

/** Label + control + hint/error wiring. Pass the control as a render function to receive the ids. */
export function Field({ label, hint, error, required, className, children }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label htmlFor={id} className="block text-body-sm font-medium text-ink">
          {label}
          {required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {typeof children === "function"
        ? children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })
        : children}
      {error ? (
        <p id={errorId} role="alert" className="text-caption text-danger-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-caption text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(controlBase, "h-8 px-3 py-0", className)} {...props} />;
});

export const Textarea = React.forwardRef(function Textarea({ className, rows = 3, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(controlBase, "px-3 py-2", className)} {...props} />;
});

export function SearchInput({ value, onChange, onClear, placeholder = "Search", className, ...props }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(controlBase, "h-8 py-0 pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden")}
        {...props}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => (onClear ? onClear() : onChange(""))}
          className={cn("absolute right-1.5 top-1/2 -translate-y-1/2 rounded-ds-sm p-1 text-ink-faint hover:text-ink", focusRing)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Native <select> styled to match: fully accessible and mobile friendly. */
export const Select = React.forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(controlBase, "h-8 appearance-none bg-none py-0 pl-3 pr-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
    </div>
  );
});

/** Checkbox with optional indeterminate state. Visually custom, natively focusable. */
export const Checkbox = React.forwardRef(function Checkbox(
  { checked, indeterminate = false, onChange, label, className, disabled, ...props },
  forwardedRef
) {
  const innerRef = useRef(null);
  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const setRefs = (node) => {
    innerRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };
  const on = checked || indeterminate;
  return (
    <span className={cn("relative inline-flex h-4 w-4 shrink-0", className)}>
      <input
        ref={setRefs}
        type="checkbox"
        checked={Boolean(checked)}
        onChange={onChange}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "peer absolute inset-0 m-0 h-4 w-4 cursor-pointer appearance-none rounded-ds-sm border border-line-strong bg-surface transition-colors",
          "checked:border-brand checked:bg-brand checked:bg-none indeterminate:border-brand indeterminate:bg-brand indeterminate:bg-none",
          "hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-50",
          focusRing
        )}
        {...props}
      />
      {on ? (
        indeterminate ? (
          <Minus className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-brand-fg" strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-brand-fg" strokeWidth={3} aria-hidden="true" />
        )
      ) : null}
    </span>
  );
});

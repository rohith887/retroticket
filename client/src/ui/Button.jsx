import React from "react";
import { Loader2 } from "lucide-react";
import { cn, focusRing } from "./cn";

const variants = {
  primary: "bg-brand text-brand-fg hover:bg-brand-strong border border-transparent",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-subtle",
  ghost: "bg-transparent text-ink-muted border border-transparent hover:bg-subtle hover:text-ink",
  danger: "bg-danger text-white border border-transparent hover:opacity-90",
  "danger-ghost": "bg-transparent text-danger-ink border border-transparent hover:bg-danger-soft",
};

const sizes = {
  sm: "h-7 px-2.5 text-caption gap-1.5",
  md: "h-8 px-3 text-body-sm gap-2",
  lg: "h-9 px-4 text-body gap-2",
};

const iconSizes = { sm: "h-7 w-7", md: "h-8 w-8", lg: "h-9 w-9" };

/**
 * The only button in the product. `as` lets it render a router <Link> or <a>.
 * Icon-only buttons must pass `aria-label`.
 */
export const Button = React.forwardRef(function Button(
  { as: Component = "button", variant = "secondary", size = "md", icon = false, loading = false, disabled, className, children, type, ...props },
  ref
) {
  const isButton = Component === "button";
  return (
    <Component
      ref={ref}
      type={isButton ? type || "button" : undefined}
      disabled={isButton ? disabled || loading : undefined}
      aria-disabled={!isButton && (disabled || loading) ? true : undefined}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-ds font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
        focusRing,
        variants[variant],
        icon ? cn(iconSizes[size], "px-0") : sizes[size],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </Component>
  );
});

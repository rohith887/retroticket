import React from "react";
import { Link } from "react-router-dom";
import { cn, focusRing } from "./cn";

/* ------------------------------- Badge ------------------------------- */

const badgeTones = {
  neutral: "bg-subtle text-ink-muted border-line",
  brand: "bg-brand-soft text-brand-ink border-brand-softline",
  success: "bg-success-soft text-success-ink border-transparent",
  warning: "bg-warning-soft text-warning-ink border-transparent",
  danger: "bg-danger-soft text-danger-ink border-transparent",
};
const dotTones = {
  neutral: "bg-ink-faint",
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function Badge({ tone = "neutral", dot = false, className, children, ...props }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-ds-sm border px-1.5 text-caption font-medium",
        badgeTones[tone],
        className
      )}
      {...props}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", dotTones[tone])} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ------------------------------- Avatar ------------------------------ */

const avatarSizes = { xs: "h-5 w-5 text-[10px]", sm: "h-7 w-7 text-caption", md: "h-8 w-8 text-body-sm", lg: "h-10 w-10 text-body" };

function initialsOf(name = "") {
  return (
    String(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "?"
  );
}

export function Avatar({ name, size = "md", className, ...props }) {
  return (
    <span
      role="img"
      aria-label={name || "User"}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-brand-soft font-medium text-brand-ink",
        avatarSizes[size],
        className
      )}
      {...props}
    >
      {initialsOf(name)}
    </span>
  );
}

/* ------------------------------ Skeleton ----------------------------- */

export function Skeleton({ className, ...props }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-ds bg-subtle", className)} {...props} />;
}

/* ----------------------------- EmptyState ---------------------------- */

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {Icon ? (
        <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-line bg-subtle text-ink-faint">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      ) : null}
      <h3 className="text-body font-medium text-ink">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-body-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ------------------------------ PageHeader --------------------------- */

/** Compact page title row. No hero, no gradients: title, one-line description, actions on the right. */
export function PageHeader({ title, description, actions, className }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-heading font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-0.5 text-body-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------- Panel ------------------------------- */

export function Panel({ as: Component = "section", className, children, ...props }) {
  return (
    <Component className={cn("rounded-ds-lg border border-line bg-surface", className)} {...props}>
      {children}
    </Component>
  );
}

export function PanelHeader({ title, description, actions, className }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="truncate text-body-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="text-caption text-ink-faint">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* --------------------------------- Kbd ------------------------------- */

export function Kbd({ children, className }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[20px] items-center justify-center rounded-ds-sm border border-line bg-subtle px-1 font-sans text-[11px] font-medium text-ink-muted",
        className
      )}
    >
      {children}
    </kbd>
  );
}

/* ------------------------------ StatTile ----------------------------- */

/** Metric tile. Pass `to` to make it a link. `tone="warning"` tints a non-zero value. */
export function StatTile({ label, value, hint, to, tone = "neutral", loading, icon: Icon, className }) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-caption font-medium text-ink-muted">{label}</span>
        {Icon ? <Icon className="h-4 w-4 text-ink-faint" aria-hidden="true" /> : null}
      </div>
      <div className={cn("mt-2 text-[28px] font-semibold leading-8 tabular-nums", tone === "warning" && Number(value) > 0 ? "text-warning-ink" : tone === "danger" && Number(value) > 0 ? "text-danger-ink" : "text-ink")}>
        {loading ? <Skeleton className="h-8 w-14" /> : value}
      </div>
      {hint ? <p className="mt-1 text-caption text-ink-faint">{hint}</p> : null}
    </>
  );
  const base = cn("block rounded-ds-lg border border-line bg-surface p-4", className);
  if (to) {
    return (
      <Link to={to} className={cn(base, "transition-colors hover:border-line-strong", focusRing)}>
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}

/* ------------------------- Detail / EntityCell ----------------------- */

/** One label/value row in a details list (drawers, summaries). Wrap rows in <dl className="divide-y divide-line">. */
export function Detail({ label, children }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2.5">
      <dt className="text-body-sm text-ink-muted">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words text-body-sm text-ink">{children}</dd>
    </div>
  );
}

/** Two-line primary cell for the first column of a list: optional avatar, title, subtitle. */
export function EntityCell({ name, title, subtitle, avatar = false, suffix }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {avatar ? <Avatar name={name || title} size="md" /> : null}
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">
          {title}
          {suffix ? <span className="ml-2 text-caption font-normal text-ink-faint">{suffix}</span> : null}
        </span>
        {subtitle ? <span className="block truncate text-caption text-ink-faint">{subtitle}</span> : null}
      </span>
    </span>
  );
}

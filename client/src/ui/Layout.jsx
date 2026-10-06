import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn, focusRing } from "./cn";
import { Panel } from "./Display";

/**
 * Standard page container. Every admin page renders inside exactly one <Page>.
 *  - fill:     list pages. Fills the viewport height; the table area scrolls, the header does not.
 *  - form:     single-column create/edit forms.
 *  - settings: stacked settings sections.
 *  - wide:     dashboards and dense multi-panel pages.
 */
const pageVariants = {
  fill: "flex h-full min-h-0 flex-col gap-4 p-4 md:p-6",
  form: "w-full max-w-3xl space-y-5 p-4 md:p-6",
  settings: "w-full max-w-4xl space-y-5 p-4 md:p-6",
  editor: "mx-auto w-full max-w-[1640px] space-y-3 px-4 py-3 md:px-6 md:py-4",
  wide: "mx-auto w-full max-w-[1400px] space-y-5 p-4 md:p-6",
};

export function Page({ variant = "fill", className, children }) {
  return <div className={cn(pageVariants[variant], className)}>{children}</div>;
}

export function BackLink({ to, children }) {
  return (
    <Link to={to} className={cn("inline-flex items-center gap-1.5 rounded-ds-sm text-body-sm text-ink-muted hover:text-ink", focusRing)}>
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </Link>
  );
}

/** A titled block on a settings/form page. */
export function Section({ title, description, actions, children, className }) {
  return (
    <Panel className={className}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-body-sm text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </Panel>
  );
}

/** Action bar pinned to the bottom of a form page: an inset card, so it never spills past the page column. */
export function FormActions({ children }) {
  return (
    <div className="sticky bottom-2 z-10 flex items-center justify-end gap-2 rounded-ds-lg border border-line bg-surface px-4 py-2.5 shadow-ds-popover">
      {children}
    </div>
  );
}

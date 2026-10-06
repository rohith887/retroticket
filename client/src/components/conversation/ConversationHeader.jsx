// Compact header shared by Ticket and Thread conversations: back link, reference, title, badges, actions.
import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "../../ui";

export function ConversationHeader({ backTo, backLabel = "Back", onBack, reference, title, badges, actions, children }) {
  return (
    <header className="shrink-0 border-b border-line px-4 py-3">
      <div className="flex items-start gap-2">
        {backTo || onBack ? (
          <Button as={backTo ? Link : "button"} to={backTo} onClick={onBack} variant="ghost" size="sm" className="-ml-2 shrink-0" aria-label={backLabel}>
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{backLabel}</span>
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            {reference ? <span className="shrink-0 text-body-sm font-medium text-ink-muted">{reference}</span> : null}
            <h1 className="min-w-0 truncate text-title font-semibold text-ink">{title}</h1>
          </div>
          {badges ? <div className="mt-1.5 flex flex-wrap items-center gap-2">{badges}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

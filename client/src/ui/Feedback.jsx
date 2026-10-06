import React, { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { cn, focusRing } from "./cn";
import { Button } from "./Button";
import { Input } from "./Form";
import { Dialog, DialogContent } from "./Overlays";
import { toast } from "./Toast";

/* ------------------------------- Alert ------------------------------- */

const alertTones = {
  info: { box: "border-line bg-subtle text-ink", icon: Info, iconClass: "text-ink-faint" },
  success: { box: "border-transparent bg-success-soft text-success-ink", icon: CheckCircle2, iconClass: "text-success" },
  warning: { box: "border-transparent bg-warning-soft text-warning-ink", icon: AlertTriangle, iconClass: "text-warning" },
  danger: { box: "border-transparent bg-danger-soft text-danger-ink", icon: AlertCircle, iconClass: "text-danger" },
};

/** Inline banner for status and errors. Use `role="alert"` (default for danger/warning) for urgent messages. */
export function Alert({ tone = "info", title, children, action, className }) {
  const { box, icon: Icon, iconClass } = alertTones[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-ds-lg border px-3 py-2.5 text-body-sm", box, className)}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? <div className={cn(title && "mt-0.5 opacity-90")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------- Switch ------------------------------ */

/** Accessible on/off toggle. Pass `aria-label` or pair with a visible <label htmlFor>. */
export const Switch = React.forwardRef(function Switch({ checked, onCheckedChange, disabled, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "bg-line-strong",
        focusRing,
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn("inline-block h-4 w-4 rounded-full bg-surface shadow-[0_0_0_1px_rgb(var(--ds-line))] transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")}
      />
    </button>
  );
});

/* --------------------------- PasswordInput --------------------------- */

export const PasswordInput = React.forwardRef(function PasswordInput({ className, ...props }, ref) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={reveal ? "text" : "password"} className={cn("pr-9", className)} {...props} />
      <button
        type="button"
        onClick={() => setReveal((v) => !v)}
        aria-label={reveal ? "Hide password" : "Show password"}
        aria-pressed={reveal}
        className={cn("absolute right-1.5 top-1/2 -translate-y-1/2 rounded-ds-sm p-1 text-ink-faint hover:text-ink", focusRing)}
      >
        {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

/* ------------------------------ Spinner ------------------------------ */

export function Spinner({ className, label = "Loading" }) {
  return <Loader2 role="status" aria-label={label} className={cn("h-4 w-4 animate-spin text-ink-faint", className)} />;
}

/* --------------------------- ConfirmDialog --------------------------- */

/**
 * The one confirmation dialog for destructive or irreversible actions.
 * `onConfirm` may be async; errors are shown as a toast and the dialog stays open.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", tone = "danger", onConfirm, children }) {
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      toast.error(error?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent
        size="sm"
        title={title}
        description={description}
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={tone === "danger" ? "danger" : "primary"} type="submit" form="confirm-dialog-form" loading={busy}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        <form id="confirm-dialog-form" onSubmit={submit}>
          {children}
        </form>
      </DialogContent>
    </Dialog>
  );
}

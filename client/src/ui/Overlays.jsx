import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check, X } from "lucide-react";
import { cn, focusRing } from "./cn";
import { Button } from "./Button";

/* ------------------------------ Tooltip ------------------------------ */

export function Tooltip({ content, children, side = "bottom", delay = 300 }) {
  if (!content) return children;
  return (
    <TooltipPrimitive.Provider delayDuration={delay}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="ds-root z-[70] rounded-ds bg-ink px-2 py-1 text-caption font-medium text-surface shadow-ds-popover data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/* -------------------------------- Menu ------------------------------- */

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ className, align = "end", sideOffset = 6, children, ...props }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "ds-root z-[60] min-w-[11rem] overflow-hidden rounded-ds-lg border border-line bg-surface p-1 shadow-ds-popover",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

const itemBase =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-ds-sm px-2 text-body-sm outline-none transition-colors " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-subtle";

export function MenuItem({ icon: Icon, danger = false, shortcut, className, children, ...props }) {
  return (
    <DropdownMenu.Item className={cn(itemBase, danger ? "text-danger-ink data-[highlighted]:bg-danger-soft" : "text-ink", className)} {...props}>
      {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <span className="flex-1 truncate">{children}</span>
      {shortcut ? <span className="text-caption text-ink-faint">{shortcut}</span> : null}
    </DropdownMenu.Item>
  );
}

export function MenuCheckboxItem({ checked, onCheckedChange, className, children, ...props }) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
      className={cn(itemBase, "pl-8 text-ink", className)}
      {...props}
    >
      <span className="absolute left-2 inline-flex h-4 w-4 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check className="h-4 w-4 text-brand" aria-hidden="true" />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuRadioGroup({ value, onValueChange, children }) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </DropdownMenu.RadioGroup>
  );
}

export function MenuRadioItem({ value, className, children, ...props }) {
  return (
    <DropdownMenu.RadioItem value={value} className={cn(itemBase, "pl-8 text-ink", className)} {...props}>
      <span className="absolute left-2 inline-flex h-4 w-4 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check className="h-4 w-4 text-brand" aria-hidden="true" />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.RadioItem>
  );
}

export function MenuLabel({ className, children }) {
  return <DropdownMenu.Label className={cn("px-2 py-1.5 text-caption font-medium text-ink-faint", className)}>{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-line" />;
}

/* ------------------------------- Popover ----------------------------- */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className, align = "end", sideOffset = 6, children, ...props }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "ds-root z-[60] w-[22rem] max-w-[calc(100vw-1rem)] rounded-ds-lg border border-line bg-surface shadow-ds-popover",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          focusRing,
          className
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

/* ------------------------------- Dialog ------------------------------ */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClass =
  "fixed inset-0 z-50 bg-overlay/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

export function DialogContent({ title, description, footer, size = "md", className, children, ...props }) {
  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" };
  const contentRef = React.useRef(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        ref={contentRef}
        tabIndex={-1}
        // Start focus on the first form field when there is one, otherwise on the dialog itself (never the Close button).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const field = contentRef.current?.querySelector("input:not([type=hidden]), select, textarea");
          (field || contentRef.current)?.focus();
        }}
        className={cn(
          "ds-root fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col",
          "rounded-ds-lg border border-line bg-surface shadow-ds-dialog focus:outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          widths[size],
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-title font-semibold text-ink">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-body-sm text-ink-muted">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="sm" icon aria-label="Close" className="-mr-2 -mt-1">
              <X className="h-4 w-4" />
            </Button>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/* ------------------------------- Drawer ------------------------------ */

/** Side sheet. Right-hand detail panel on desktop, full-screen on small screens. */
export const Drawer = DialogPrimitive.Root;
export const DrawerClose = DialogPrimitive.Close;

export function DrawerContent({ title, description, side = "right", header, footer, className, children, ...props }) {
  const contentRef = React.useRef(null);
  const sideClass =
    side === "left"
      ? "left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left sm:max-w-[18rem]"
      : "right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right sm:max-w-[28rem]";
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        ref={contentRef}
        tabIndex={-1}
        // Focus the panel itself (not the close button) so no ring flashes on open; Tab still reaches everything.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current?.focus();
        }}
        className={cn(
          "ds-root fixed inset-y-0 z-50 flex w-full flex-col border-line bg-surface shadow-ds-dialog focus:outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-200 data-[state=closed]:duration-150",
          sideClass,
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            {header || (
              <>
                <DialogPrimitive.Title className="truncate text-title font-semibold text-ink">{title}</DialogPrimitive.Title>
                {description ? <DialogPrimitive.Description className="text-body-sm text-ink-muted">{description}</DialogPrimitive.Description> : null}
              </>
            )}
            {header ? (
              <>
                <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">{description || title}</DialogPrimitive.Description>
              </>
            ) : null}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="sm" icon aria-label="Close panel">
              <X className="h-4 w-4" />
            </Button>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

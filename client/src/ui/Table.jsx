import React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn, focusRing } from "./cn";

/**
 * Data table primitives. The scroll container is the caller's responsibility: wrap in an element with
 * `overflow-auto` and a bounded height and the header stays sticky.
 */
export function Table({ className, children, ...props }) {
  return (
    <table className={cn("w-full border-separate border-spacing-0 text-body-sm", className)} {...props}>
      {children}
    </table>
  );
}

export function THead({ className, children, ...props }) {
  return (
    <thead className={cn("[&_th]:sticky [&_th]:top-0 [&_th]:z-10", className)} {...props}>
      {children}
    </thead>
  );
}

export function TBody({ className, children, ...props }) {
  return (
    <tbody className={cn(className)} {...props}>
      {children}
    </tbody>
  );
}

export function Tr({ selected = false, interactive = false, className, children, ...props }) {
  return (
    <tr
      data-selected={selected || undefined}
      className={cn(
        "group",
        interactive && "cursor-pointer",
        "[&>td]:border-b [&>td]:border-line [&>td]:bg-surface",
        interactive && "hover:[&>td]:bg-subtle",
        "data-[selected]:[&>td]:bg-brand-soft",
        className
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function Th({ sortable = false, sorted = null, onSort, className, children, ...props }) {
  const ariaSort = sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : sortable ? "none" : undefined;
  const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        "h-9 whitespace-nowrap border-b border-line bg-canvas px-3 text-left text-caption font-medium text-ink-muted",
        className
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn("-mx-1 inline-flex items-center gap-1 rounded-ds-sm px-1 hover:text-ink", focusRing)}
        >
          {children}
          <SortIcon className={cn("h-3 w-3", sorted ? "text-ink" : "text-ink-faint")} aria-hidden="true" />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({ className, children, ...props }) {
  return (
    <td className={cn("h-11 px-3 align-middle text-ink", className)} {...props}>
      {children}
    </td>
  );
}

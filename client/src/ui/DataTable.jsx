import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "./cn";
import { Button } from "./Button";
import { Checkbox } from "./Form";
import { EmptyState, Skeleton } from "./Display";
import { Table, TBody, Td, Th, THead, Tr } from "./Table";

const hideBelow = { md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" };

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The list-page table: sticky header, sortable columns, optional selection, row hover actions,
 * pagination, skeleton / error / empty states, and a card layout below the md breakpoint.
 *
 * columns: [{ id, header, cell(row), sortValue?(row), className?, hideBelow?: 'md'|'lg'|'xl', mobile?: false }]
 *   - the first column is the row's primary cell (rendered as a button when `onRowClick` is set; keep its content inline)
 *   - a column with `sortValue` is sortable
 * Put the table in a <Page variant="fill">; the table area scrolls and everything above it stays put.
 */
export function DataTable({
  columns,
  rows,
  getRowId,
  loading = false,
  error = null,
  onRetry,
  empty,
  onRowClick,
  selected,
  onSelectedChange,
  rowActions,
  pageSize = 25,
  resetKey,
  initialSort,
  label = "Results",
}) {
  const [sort, setSort] = useState(initialSort || null);
  const [page, setPage] = useState(0);

  useEffect(() => setPage(0), [resetKey]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.id === sort.id);
    if (!column?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => compare(column.sortValue(a), column.sortValue(b)) * dir);
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const selectable = Boolean(onSelectedChange);
  const allSelected = visible.length > 0 && visible.every((row) => selected?.has(getRowId(row)));
  const someSelected = visible.some((row) => selected?.has(getRowId(row)));
  const showTable = !loading && !error && rows.length > 0;

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  }

  function toggleAll() {
    const next = new Set(selected);
    visible.forEach((row) => (allSelected ? next.delete(getRowId(row)) : next.add(getRowId(row))));
    onSelectedChange(next);
  }

  function changeSort(id) {
    setSort((current) => (current?.id === id ? { id, dir: current.dir === "asc" ? "desc" : "asc" } : { id, dir: "asc" }));
  }

  const [primary, ...rest] = columns;

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden min-h-0 overflow-auto rounded-ds-lg border border-line bg-surface md:block" aria-label={label}>
        <Table>
          <THead>
            <tr>
              {selectable ? (
                <Th className="w-10 pl-4 pr-0">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={!allSelected && someSelected}
                    onChange={toggleAll}
                    label="Select all rows on this page"
                    disabled={visible.length === 0}
                  />
                </Th>
              ) : null}
              {columns.map((column) => (
                <Th
                  key={column.id}
                  className={cn(column.hideBelow && hideBelow[column.hideBelow], column.headerClassName)}
                  sortable={Boolean(column.sortValue)}
                  sorted={sort?.id === column.id ? sort.dir : null}
                  onSort={() => changeSort(column.id)}
                >
                  {column.header}
                </Th>
              ))}
              {rowActions ? (
                <Th className="w-28">
                  <span className="sr-only">Actions</span>
                </Th>
              ) : null}
            </tr>
          </THead>
          <TBody>
            {loading &&
              Array.from({ length: 6 }, (_, i) => (
                <Tr key={i}>
                  {selectable ? (
                    <Td className="w-10 pl-4 pr-0">
                      <Skeleton className="h-4 w-4" />
                    </Td>
                  ) : null}
                  {columns.map((column, index) => (
                    <Td key={column.id} className={cn(column.hideBelow && hideBelow[column.hideBelow])}>
                      <Skeleton className={index === 0 ? "h-4 w-40" : "h-3 w-20"} />
                    </Td>
                  ))}
                  {rowActions ? <Td /> : null}
                </Tr>
              ))}

            {showTable &&
              visible.map((row) => {
                const id = getRowId(row);
                return (
                  <Tr key={id} interactive={Boolean(onRowClick)} selected={selected?.has(id)} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                    {selectable ? (
                      <Td className="w-10 pl-4 pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected?.has(id)} onChange={() => toggle(id)} label="Select row" />
                      </Td>
                    ) : null}
                    {columns.map((column, index) => (
                      <Td key={column.id} className={cn(column.hideBelow && hideBelow[column.hideBelow], column.className)}>
                        {index === 0 && onRowClick ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRowClick(row);
                            }}
                            className="max-w-full rounded-ds-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                          >
                            {column.cell(row)}
                          </button>
                        ) : (
                          column.cell(row)
                        )}
                      </Td>
                    ))}
                    {rowActions ? (
                      <Td className="pr-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                          {rowActions(row)}
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
          </TBody>
        </Table>

        {error ? (
          <EmptyState icon={AlertTriangle} title="We couldn't load this list" description={error.message} action={onRetry ? <Button onClick={onRetry}>Try again</Button> : null} />
        ) : null}
        {!loading && !error && rows.length === 0 ? empty : null}
      </div>

      {/* Mobile card list */}
      <div className="min-h-0 space-y-2 overflow-auto md:hidden" aria-label={label}>
        {loading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        {error ? <EmptyState icon={AlertTriangle} title="We couldn't load this list" description={error.message} action={onRetry ? <Button onClick={onRetry}>Try again</Button> : null} /> : null}
        {!loading && !error && rows.length === 0 ? empty : null}
        {showTable &&
          visible.map((row) => {
            const id = getRowId(row);
            const isSelected = selected?.has(id);
            return (
              <div key={id} className={cn("flex items-start gap-3 rounded-ds-lg border p-3", isSelected ? "border-brand-softline bg-brand-soft" : "border-line bg-surface")}>
                {selectable ? <Checkbox checked={isSelected} onChange={() => toggle(id)} label="Select row" className="mt-1" /> : null}
                <div className="min-w-0 flex-1">
                  {onRowClick ? (
                    <button type="button" onClick={() => onRowClick(row)} className="block w-full rounded-ds-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                      {primary.cell(row)}
                    </button>
                  ) : (
                    primary.cell(row)
                  )}
                  <dl className="mt-2 space-y-1">
                    {rest
                      .filter((column) => column.mobile !== false)
                      .map((column) => (
                        <div key={column.id} className="flex items-baseline justify-between gap-3 text-body-sm">
                          <dt className="shrink-0 text-caption text-ink-faint">{column.header}</dt>
                          <dd className="min-w-0 text-right text-ink">{column.cell(row)}</dd>
                        </div>
                      ))}
                  </dl>
                  {rowActions ? <div className="mt-2 flex items-center justify-end gap-1">{rowActions(row)}</div> : null}
                </div>
              </div>
            );
          })}
      </div>

      {showTable && pageCount > 1 ? (
        <div className="flex items-center justify-between text-body-sm text-ink-muted">
          <span>
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setPage(safePage - 1)} disabled={safePage === 0}>
              Previous
            </Button>
            <Button size="sm" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

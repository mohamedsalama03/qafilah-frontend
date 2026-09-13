"use client";

import {
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type OnChangeFn,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState, type ErrorStateProps } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

const features = tableFeatures({ rowSortingFeature });
export type DataTableColumn<TData extends RowData> = ColumnDef<typeof features, TData, unknown>;

export interface DataTablePagination {
  /** An honest page/range label from the verified response; no assumed totals. */
  label: string;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

export interface DataTableProps<TData extends RowData> {
  caption: string;
  data: TData[];
  columns: DataTableColumn<TData>[];
  getRowId: (row: TData) => string;
  pagination?: DataTablePagination;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  toolbar?: ReactNode;
  mobileRow?: (row: TData) => ReactNode;
  rowActions?: (row: TData) => ReactNode;
  loading?: boolean;
  error?: Omit<ErrorStateProps, "retry">;
  onRetry?: () => void;
  emptyState?: ReactNode;
}

/**
 * Render only the current authoritative page. Filtering, sorting and pagination
 * belong to verified backend contracts and the owning feature's URL/query state.
 * Cursor navigation is passed as callbacks so cursors stay opaque.
 */
export function DataTable<TData extends RowData>({
  caption,
  data,
  columns,
  getRowId,
  pagination,
  sorting = [],
  onSortingChange,
  toolbar,
  mobileRow,
  rowActions,
  loading = false,
  error,
  onRetry,
  emptyState,
}: DataTableProps<TData>) {
  const table = useTable({
    features,
    data,
    columns,
    getRowId,
    manualSorting: true,
    enableSorting: Boolean(onSortingChange),
    defaultColumn: { enableSorting: false },
    enableMultiSort: false,
    state: { sorting },
    onSortingChange,
  });
  const hasRows = !loading && !error && data.length > 0;
  const columnCount = Math.max(1, table.getAllLeafColumns().length + (rowActions ? 1 : 0));

  return (
    <section
      aria-label={caption}
      aria-busy={loading || undefined}
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface"
    >
      {toolbar && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          {toolbar}
        </div>
      )}
      {loading && (
        <p role="status" className="sr-only">
          Loading {caption.toLowerCase()}…
        </p>
      )}
      {error ? (
        <ErrorState {...error} retry={onRetry} />
      ) : (
        <>
          <div
            role="region"
            aria-label={`${caption}, scroll horizontally for more columns`}
            tabIndex={0}
            className={cn(
              "relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
              mobileRow && hasRows && "hidden md:block",
            )}
          >
            <table className="w-full min-w-[36rem] border-collapse text-start text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead className="bg-surface-subtle text-xs font-medium text-text-muted">
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => {
                      const direction = header.column.getIsSorted();
                      const SortIcon =
                        direction === "asc"
                          ? ArrowUp
                          : direction === "desc"
                            ? ArrowDown
                            : ArrowUpDown;
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          colSpan={header.colSpan}
                          aria-sort={
                            direction === "asc"
                              ? "ascending"
                              : direction === "desc"
                                ? "descending"
                                : header.column.getCanSort()
                                  ? "none"
                                  : undefined
                          }
                          className="border-b border-border px-4 py-3 text-start font-medium whitespace-nowrap"
                        >
                          {!header.isPlaceholder &&
                            (header.column.getCanSort() ? (
                              <button
                                type="button"
                                className="inline-flex min-h-8 items-center gap-1.5 rounded text-start hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
                                onClick={header.column.getToggleSortingHandler()}
                                disabled={loading}
                              >
                                <table.FlexRender header={header} />
                                <SortIcon className="size-3.5" aria-hidden="true" />
                              </button>
                            ) : (
                              <table.FlexRender header={header} />
                            ))}
                        </th>
                      );
                    })}
                    {rowActions && (
                      <th scope="col" className="w-14 border-b border-border px-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                ))}
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 5 }, (_, index) => (
                      <tr key={`skeleton-${index}`} aria-hidden="true">
                        {Array.from({ length: columnCount }, (_, column) => (
                          <td
                            key={`skeleton-cell-${column}`}
                            className="border-b border-border px-4 py-4"
                          >
                            <Skeleton className={column === 0 ? "h-4 w-24" : "h-4 w-16"} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : table.getRowModel().rows.map((row) => (
                      <tr
                        key={row.id}
                        data-row-id={row.id}
                        className="border-b border-border last:border-b-0 hover:bg-surface-subtle/60"
                      >
                        {row.getAllCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-3 align-middle text-text">
                            <table.FlexRender cell={cell} />
                          </td>
                        ))}
                        {rowActions && (
                          <td className="px-2 py-1 text-end">{rowActions(row.original)}</td>
                        )}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {mobileRow && hasRows && (
            <div className="md:hidden">
              {onSortingChange && (
                <div
                  role="group"
                  aria-label="Sort records"
                  className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2"
                >
                  <span className="text-xs text-text-muted">Sort by</span>
                  {table
                    .getHeaderGroups()
                    .flatMap((group) => group.headers)
                    .filter((header) => header.column.getCanSort())
                    .map((header) => {
                      const direction = header.column.getIsSorted();
                      const SortIcon =
                        direction === "asc"
                          ? ArrowUp
                          : direction === "desc"
                            ? ArrowDown
                            : ArrowUpDown;
                      return (
                        <Button
                          key={header.id}
                          size="sm"
                          variant="ghost"
                          aria-pressed={Boolean(direction)}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          <SortIcon className="size-3.5" aria-hidden="true" />
                          <span className="sr-only">
                            {direction === "asc"
                              ? "Ascending"
                              : direction === "desc"
                                ? "Descending"
                                : "Unsorted"}
                          </span>
                        </Button>
                      );
                    })}
                </div>
              )}
              <ul className="divide-y divide-border" aria-label={`${caption} summaries`}>
                {data.map((row) => (
                  <li
                    key={getRowId(row)}
                    className="flex items-start justify-between gap-3 px-4 py-4"
                  >
                    <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">{mobileRow(row)}</div>
                    {rowActions && <div className="shrink-0">{rowActions(row)}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!loading &&
            data.length === 0 &&
            (emptyState ?? (
              <EmptyState
                title="No records to display"
                description="Records will appear here when they are available."
              />
            ))}
        </>
      )}
      {pagination && !error && (
        <nav
          aria-label={`${caption} pagination`}
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3"
        >
          <p className="text-xs text-text-muted" aria-live="polite">
            {pagination.label}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => pagination.onPreviousPage()}
              disabled={loading || !pagination.hasPreviousPage}
            >
              <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
              Previous
            </Button>
            <Button
              size="sm"
              onClick={() => pagination.onNextPage()}
              disabled={loading || !pagination.hasNextPage}
            >
              Next
              <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}
    </section>
  );
}

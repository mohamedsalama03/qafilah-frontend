"use client";

import { ArrowUpRight, Package } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, type DataTableColumn } from "@/components/data-table/data-table";
import { ActionMenu } from "@/components/ui/action-menu";
import { Select } from "@/components/ui/form-controls";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type SampleRecord = {
  reference: string;
  name: string;
  category: string;
  state: "Ready" | "Draft";
  updated: string;
};
const samplePages: SampleRecord[][] = [
  [
    {
      reference: "EX-001",
      name: "Everyday canvas tote",
      category: "Accessories",
      state: "Ready",
      updated: "12 Sep 2026",
    },
    {
      reference: "EX-002",
      name: "Stoneware coffee cup",
      category: "Home & living",
      state: "Ready",
      updated: "12 Sep 2026",
    },
    {
      reference: "EX-003",
      name: "Linen cushion cover",
      category: "Home & living",
      state: "Draft",
      updated: "11 Sep 2026",
    },
    {
      reference: "EX-004",
      name: "Hardcover notebook",
      category: "Stationery",
      state: "Ready",
      updated: "11 Sep 2026",
    },
    {
      reference: "EX-005",
      name: "Cotton hand towel",
      category: "Home & living",
      state: "Ready",
      updated: "10 Sep 2026",
    },
    {
      reference: "EX-006",
      name: "Everyday carry pouch with a deliberately long descriptive name",
      category: "Accessories",
      state: "Draft",
      updated: "10 Sep 2026",
    },
    {
      reference: "EX-007",
      name: "Oak desk tray",
      category: "Workspace",
      state: "Ready",
      updated: "09 Sep 2026",
    },
    {
      reference: "EX-008",
      name: "Glass water carafe",
      category: "Home & living",
      state: "Draft",
      updated: "09 Sep 2026",
    },
  ],
  [
    {
      reference: "EX-009",
      name: "Woven storage basket",
      category: "Home & living",
      state: "Ready",
      updated: "08 Sep 2026",
    },
    {
      reference: "EX-010",
      name: "Pocket journal",
      category: "Stationery",
      state: "Draft",
      updated: "08 Sep 2026",
    },
  ],
];
const columns: DataTableColumn<SampleRecord>[] = [
  {
    accessorKey: "name",
    header: "Record",
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <span className="hidden size-9 shrink-0 items-center justify-center rounded-sm border border-border bg-background lg:flex">
          <Package size={17} strokeWidth={1.5} className="text-text-muted" aria-hidden="true" />
        </span>
        <div className="max-w-64">
          <span className="font-medium">{row.original.name}</span>
          <p className="mt-0.5 text-xs text-text-muted">{row.original.reference}</p>
        </div>
      </div>
    ),
  },
  {
    accessorKey: "state",
    header: "Example state",
    cell: ({ row }) => (
      <StatusBadge tone={row.original.state === "Ready" ? "success" : "neutral"}>
        {row.original.state}
      </StatusBadge>
    ),
  },
  { accessorKey: "category", header: "Category" },
  {
    accessorKey: "updated",
    header: "Updated",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-text-muted">{row.original.updated}</span>
    ),
  },
];

export function TablePattern() {
  const router = useRouter();
  const search = useSearchParams();
  const page = search.get("page") === "2" ? 1 : 0;
  const requestedState = search.get("state") ?? "standard";
  const state = ["standard", "loading", "empty", "error"].includes(requestedState)
    ? requestedState
    : "standard";
  function navigate(nextPage: number, nextState = state) {
    const params = new URLSearchParams();
    if (nextPage === 1) params.set("page", "2");
    if (nextState !== "standard") params.set("state", nextState);
    router.push(`/design-system/table${params.size ? `?${params}` : ""}`, { scroll: false });
  }
  return (
    <>
      <PageHeader
        title="Sample records"
        description="A table pattern for daily operations. All records on this page are examples."
        status={<StatusBadge>Component example</StatusBadge>}
        primaryAction={
          <Link
            href="/design-system/form"
            prefetch={false}
            className="inline-flex min-h-10 items-center gap-2 rounded-sm bg-brand px-3.5 text-sm font-medium text-white hover:opacity-90"
          >
            View form pattern
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        }
      />
      <DataTable
        caption="Sample records"
        data={state === "empty" ? [] : samplePages[page]}
        columns={columns}
        getRowId={(row) => row.reference}
        loading={state === "loading"}
        error={
          state === "error"
            ? {
                title: "Records couldn’t load",
                description:
                  "This is the network-error preview. Try again to return to the example records.",
              }
            : undefined
        }
        onRetry={() => navigate(page, "standard")}
        toolbar={
          <>
            <p className="me-auto text-sm font-medium">Record list</p>
            <label htmlFor="preview-state" className="text-xs text-text-muted">
              Preview state
            </label>
            <Select
              id="preview-state"
              value={state}
              onChange={(event) => navigate(page, event.target.value)}
              className="w-32"
            >
              <option value="standard">Standard</option>
              <option value="loading">Loading</option>
              <option value="empty">Empty</option>
              <option value="error">Error</option>
            </Select>
          </>
        }
        pagination={{
          label: state === "empty" ? "No example records" : `Example page ${page + 1} of 2`,
          hasPreviousPage: page === 1 && state !== "empty",
          hasNextPage: page === 0 && state !== "empty",
          onPreviousPage: () => navigate(0),
          onNextPage: () => navigate(1),
        }}
        mobileRow={(row) => (
          <>
            <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
              <span className="font-medium">{row.name}</span>
              <StatusBadge tone={row.state === "Ready" ? "success" : "neutral"}>
                {row.state}
              </StatusBadge>
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              {row.reference} · {row.category}
            </p>
            <p className="mt-1 text-xs text-text-muted">Updated {row.updated}</p>
          </>
        )}
        rowActions={(row) => (
          <ActionMenu
            label={`Actions for ${row.reference}`}
            actions={[
              {
                id: "detail",
                label: "View detail pattern",
                onSelect: () => router.push("/design-system/detail"),
              },
            ]}
          />
        )}
      />
      <p className="mt-4 text-xs leading-5 text-text-muted">
        These example pages demonstrate pagination and responsive rows. No backend request, product
        filter or commerce action is performed.
      </p>
      <span className="sr-only">QAFILAH_F1_DEVELOPMENT_FIXTURE_ONLY</span>
    </>
  );
}

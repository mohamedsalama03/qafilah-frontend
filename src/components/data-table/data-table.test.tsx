import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnChangeFn, SortingState } from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableColumn } from "@/components/data-table/data-table";

type ExampleRow = { id: string; name: string };
const rows: ExampleRow[] = [
  { id: "example-z", name: "Z example" },
  { id: "example-a", name: "A example" },
];
const columns: DataTableColumn<ExampleRow>[] = [
  { accessorKey: "name", header: "Name", enableSorting: true },
];

describe("DataTable server contract", () => {
  it("requests the next authoritative page without slicing data or altering opaque cursor state", async () => {
    const user = userEvent.setup();
    const next = vi.fn();
    const previous = vi.fn();
    render(
      <DataTable
        caption="Example records"
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        pagination={{
          label: "Current result page",
          hasPreviousPage: false,
          hasNextPage: true,
          onNextPage: next,
          onPreviousPage: previous,
        }}
      />,
    );
    const bodyRows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(bodyRows.map((row) => row.getAttribute("data-row-id"))).toEqual([
      "example-z",
      "example-a",
    ]);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(next).toHaveBeenCalledExactlyOnceWith();
    expect(previous).not.toHaveBeenCalled();
    expect(screen.getByText("Z example")).toBeInTheDocument();
    expect(screen.getByText("A example")).toBeInTheDocument();
  });

  it("requests sorting without sorting the partial current page in the browser", async () => {
    const user = userEvent.setup();
    const onSortingChange = vi.fn<OnChangeFn<SortingState>>();
    render(
      <DataTable
        caption="Example records"
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        sorting={[]}
        onSortingChange={onSortingChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(onSortingChange).toHaveBeenCalledOnce();
    const updater = onSortingChange.mock.calls[0][0];
    expect(typeof updater === "function" ? updater([]) : updater).toEqual([
      { id: "name", desc: false },
    ]);
    expect(
      within(screen.getByRole("table"))
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(["Z example", "A example"]);
  });

  it("does not expose sorting when no verified server sorting handler exists", () => {
    render(
      <DataTable
        caption="Example records"
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
      />,
    );
    expect(screen.queryByRole("button", { name: "Name" })).not.toBeInTheDocument();
  });

  it("hides stale rows and disables paging during loading", () => {
    render(
      <DataTable
        caption="Example records"
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        loading
        pagination={{
          label: "Loading result page",
          hasPreviousPage: true,
          hasNextPage: true,
          onNextPage: vi.fn(),
          onPreviousPage: vi.fn(),
        }}
      />,
    );
    expect(screen.queryByText("Z example")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading example records");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("replaces data with contextual errors and recovery", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      <DataTable
        caption="Example records"
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        error={{
          title: "Records unavailable",
          description: "Try loading this page again.",
          requestId: "safe-reference",
        }}
        onRetry={retry}
      />,
    );
    expect(screen.queryByText("Z example")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Reference ID: safe-reference");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

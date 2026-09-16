"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormField, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/form-controls";
import { ErrorState } from "@/components/ui/error-state";
import { normalizeUnexpectedError } from "@/lib/api/errors";
import { useProductCategories } from "../queries";
import { normalizeCategoryCriteria, productCriteriaSchema, type ProductCriteria } from "../model";

function CategoryFilter() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState({ id: "", name: "" });
  const query = useProductCategories(
    normalizeCategoryCriteria({ sort: "name_asc", per_page: 100 }),
    cursor,
  );
  if (query.error)
    return (
      <ErrorState
        title="Categories couldn’t be loaded"
        description={normalizeUnexpectedError(query.error).message}
        retry={() => {
          setSelected({ id: "", name: "" });
          if (normalizeUnexpectedError(query.error).kind === "validation" && cursor)
            setCursor(null);
          else void query.refetch();
        }}
      />
    );
  if (query.isPending || query.isFetching)
    return (
      <p role="status" className="text-xs text-text-muted">
        Loading categories…
      </p>
    );
  const options = query.data?.categories ?? [];
  return (
    <div className="space-y-2">
      <FormField id="products-category" label="Category">
        <Select
          name="category"
          value={selected.id}
          onChange={(event) =>
            setSelected({
              id: event.target.value,
              name: event.target.selectedOptions[0]?.textContent ?? "",
            })
          }
        >
          <option value="">All categories</option>
          {selected.id && !options.some((option) => option.id === selected.id) && (
            <option value={selected.id}>{selected.name}</option>
          )}
          {options.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </FormField>
      {query.data &&
        (query.data.pagination.next_cursor || query.data.pagination.previous_cursor) && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!query.data.pagination.previous_cursor || query.isFetching}
              onClick={() => setCursor(query.data!.pagination.previous_cursor)}
            >
              Previous categories
            </Button>
            <Button
              size="sm"
              disabled={!query.data.pagination.next_cursor || query.isFetching}
              onClick={() => setCursor(query.data!.pagination.next_cursor)}
            >
              More categories
            </Button>
          </div>
        )}
    </div>
  );
}

export function ProductFilters({
  canViewCategories,
  pending,
  onApply,
  onReset,
}: {
  canViewCategories: boolean;
  pending: boolean;
  onApply: (criteria: ProductCriteria) => void;
  onReset: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "").trim() || undefined;
    const day = (name: string, end: boolean) =>
      value(name) ? `${value(name)}T${end ? "23:59:59.999999" : "00:00:00"}+00:00` : undefined;
    const parsed = productCriteriaSchema.safeParse({
      q: value("q"),
      status: value("status"),
      sort: value("sort"),
      per_page: Number(data.get("per_page")),
      category: canViewCategories ? value("category") : undefined,
      created_from: day("created_from", false),
      created_to: day("created_to", true),
      updated_from: day("updated_from", false),
      updated_to: day("updated_to", true),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      const control = form.elements.namedItem(Object.keys(next)[0]!);
      if (control instanceof HTMLElement) {
        const disclosure = control.closest("details");
        if (disclosure) disclosure.open = true;
        control.focus();
      }
      return;
    }
    setErrors({});
    onApply(parsed.data);
  }
  return (
    <form
      onSubmit={apply}
      className="space-y-4 border-b border-border p-4 sm:p-5"
      aria-label="Product filters"
    >
      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,2fr)_1fr_1fr_7rem]">
        <FormField
          id="products-search"
          label="Search products"
          description="Starts with a product name · 2–80 characters"
          error={errors.q}
        >
          <Input name="q" type="search" placeholder="Search by name prefix" autoComplete="off" />
        </FormField>
        <FormField id="products-status" label="Status" error={errors.status}>
          <Select name="status" defaultValue="">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </Select>
        </FormField>
        <FormField id="products-sort" label="Sort" error={errors.sort}>
          <Select name="sort" defaultValue="newest">
            <option value="newest">Newest created</option>
            <option value="oldest">Oldest created</option>
            <option value="name_asc">Name: A–Z</option>
            <option value="name_desc">Name: Z–A</option>
          </Select>
        </FormField>
        <FormField id="products-page-size" label="Page size" error={errors.per_page}>
          <Select name="per_page" defaultValue="25">
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
          </Select>
        </FormField>
      </div>
      <details className="group">
        <summary className="w-fit rounded-sm py-1 text-sm font-medium text-brand underline-offset-4 hover:underline">
          {canViewCategories ? "Date and category filters" : "Date filters"}
        </summary>
        <p className="mt-3 text-xs leading-5 text-text-muted">
          Dates use UTC. Choose both dates for each range, up to 366 days. Updated dates also
          respect the creation window.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(
            [
              ["created_from", "Created from"],
              ["created_to", "Created to"],
              ["updated_from", "Updated from"],
              ["updated_to", "Updated to"],
            ] as const
          ).map(([name, label]) => (
            <FormField key={name} id={`products-${name}`} label={label} error={errors[name]}>
              <Input name={name} type="date" />
            </FormField>
          ))}
        </div>
        {canViewCategories && (
          <div className="mt-3 max-w-md">
            <CategoryFilter />
          </div>
        )}
      </details>
      {Object.keys(errors).length > 0 && (
        <FormError message="Review the highlighted filters before applying." />
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" type="submit" disabled={pending}>
          Apply filters
        </Button>
        <Button onClick={onReset}>Reset filters</Button>
      </div>
    </form>
  );
}

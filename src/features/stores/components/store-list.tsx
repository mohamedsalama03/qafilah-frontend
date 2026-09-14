"use client";

import { ArrowRight, Check } from "lucide-react";
import { FormField, Input } from "@/components/ui/field";
import type { AccessibleStore } from "@/lib/backend/contracts";

export function StoreList({
  stores,
  search,
  onSearch,
  onSelect,
  selectedUuid,
  searchId,
}: {
  stores: readonly AccessibleStore[];
  search: string;
  onSearch: (value: string) => void;
  onSelect: (uuid: string) => void;
  selectedUuid?: string | null;
  searchId: string;
}) {
  const matching = stores.filter((store) =>
    store.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <div className="min-w-0 space-y-4">
      <FormField id={searchId} label="Find a store">
        <Input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          autoComplete="off"
          placeholder="Search available stores"
        />
      </FormField>
      <p className="text-xs text-text-muted" role="status">
        {matching.length} {matching.length === 1 ? "store" : "stores"} available
        {search.trim() ? " matching your search" : ""}
      </p>
      {matching.length ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-surface">
          {matching.map((store) => (
            <li key={store.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(store.id)}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-md px-4 py-3 text-start hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-solid focus-visible:outline-focus"
                aria-label={`Open ${store.name}`}
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="block text-sm font-medium">{store.name}</span>
                  <span className="mt-1 block text-xs capitalize text-text-muted">
                    {store.status}
                  </span>
                </span>
                {store.id === selectedUuid ? (
                  <>
                    <span className="sr-only">Current store</span>
                    <Check size={17} className="shrink-0 text-brand" aria-hidden="true" />
                  </>
                ) : (
                  <ArrowRight size={17} className="shrink-0 text-text-muted" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-sm text-text-muted">
          No stores match your search. Try another name.
        </p>
      )}
    </div>
  );
}

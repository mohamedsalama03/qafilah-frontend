"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronsUpDown, Store, X } from "lucide-react";
import { useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { useStores } from "./store-provider";
import { StoreList } from "./store-list";
import { confirmUnsavedNavigation } from "@/lib/forms/unsaved-changes";

export function StoreSwitcher() {
  const { controller, state } = useStores();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const id = useId();
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Switch store"
          className="flex min-h-16 w-full items-center gap-2.5 rounded-md border border-border bg-surface/70 p-3 text-start hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Store size={18} className="shrink-0 text-text-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span className="block text-[13px] font-medium">
              {state.context?.store.name ?? "Choose a store"}
            </span>
            <span className="mt-1 block text-xs text-text-muted">Switch store</span>
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay
          data-merchant-private-overlay=""
          className="fixed inset-0 z-50 bg-text/30"
        />
        <Dialog.Content
          data-merchant-private-overlay=""
          className="fixed start-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-surface p-5 shadow-lg rtl:translate-x-1/2"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Switch store</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-text-muted">
                Choose a store available to your account.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label="Close store switcher">
                <X size={18} aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="mt-5 min-h-0 overflow-y-auto p-0.5">
            {state.discoveryError && (
              <ErrorState
                title="Stores couldn’t be refreshed"
                description={state.discoveryError.message}
                requestId={state.discoveryError.requestId}
                retry={() => void controller.discover()}
              />
            )}
            {state.discoveryStatus === "loading" && !state.stores.length ? (
              <p role="status" className="py-5 text-sm text-text-muted">
                Loading your stores…
              </p>
            ) : (
              <StoreList
                stores={state.stores}
                search={search}
                onSearch={setSearch}
                selectedUuid={state.selectedUuid}
                searchId={`${id}-search`}
                onSelect={(uuid) => {
                  if (uuid !== state.selectedUuid && !confirmUnsavedNavigation()) return;
                  void controller.select(uuid);
                  setOpen(false);
                  router.push(
                    `/stores/${uuid}${/^\/stores\/[^/]+\/products(?:\/|$)/.test(pathname) ? "/products" : ""}`,
                  );
                }}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

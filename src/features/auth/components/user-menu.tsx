"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMerchantSession } from "./session-boundary";
import { useMerchantPrincipal } from "@/features/stores/components/store-provider";

export function UserMenu() {
  const principal = useMerchantPrincipal();
  const { auth } = useMerchantSession();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="icon" variant="ghost" aria-label="Account menu">
          <UserRound size={18} aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-merchant-private-overlay=""
          align="end"
          sideOffset={5}
          className="z-50 w-64 max-w-[calc(100vw-2rem)] rounded-md bg-surface p-1 shadow-lg ring-1 ring-border"
        >
          <DropdownMenu.Label className="min-w-0 px-3 py-3 [overflow-wrap:anywhere]">
            <p className="text-sm font-semibold">{principal.displayName ?? "Merchant account"}</p>
            {principal.emailVerified !== undefined && (
              <p className="mt-1 text-xs font-normal text-text-muted">
                {principal.emailVerified ? "Email verified" : "Email not verified"}
              </p>
            )}
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => void auth.logout()}
            className="flex min-h-11 cursor-default items-center rounded px-3 py-2 text-sm text-danger outline-none focus:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-solid focus-visible:outline-focus md:min-h-8"
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

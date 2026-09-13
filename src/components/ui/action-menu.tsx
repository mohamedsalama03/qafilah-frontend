"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface ResourceAction {
  id: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function ActionMenu({ label, actions }: { label: string; actions: ResourceAction[] }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}>
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={5}
          className="z-50 min-w-44 rounded-md bg-surface p-1 shadow-lg ring-1 ring-border"
        >
          {actions.map((action, index) => (
            <div key={action.id}>
              {action.destructive && index > 0 && !actions[index - 1].destructive && (
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
              )}
              <DropdownMenu.Item
                onSelect={action.onSelect}
                disabled={action.disabled}
                className={cn(
                  "flex min-h-11 cursor-default items-center rounded px-3 py-2 text-sm outline-none focus:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-solid focus-visible:outline-focus data-[disabled]:pointer-events-none data-[disabled]:opacity-50 md:min-h-8",
                  action.destructive ? "text-danger" : "text-text",
                )}
              >
                {action.label}
              </DropdownMenu.Item>
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

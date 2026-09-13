"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

/** Supplementary hints only. Controls must retain their own accessible labels. */
export function Tooltip({ children, content }: { children: ReactElement; content: string }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-50 max-w-64 rounded-md bg-text px-3 py-2 text-xs leading-5 text-white shadow-lg"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-text" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

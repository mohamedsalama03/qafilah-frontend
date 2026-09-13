"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronRight,
  Home,
  LayoutList,
  Menu,
  PanelLeft,
  SquarePen,
  Store,
  Table2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Brand } from "./brand";

export interface ShellNavigationItem {
  href: string;
  label: string;
  icon: "home" | "table" | "detail" | "form" | "components";
}
const icons = {
  home: Home,
  table: Table2,
  detail: LayoutList,
  form: SquarePen,
  components: PanelLeft,
};

export function AppShell({
  children,
  navigation,
  title,
  review = false,
  storeContext,
}: {
  children: React.ReactNode;
  navigation: readonly ShellNavigationItem[];
  title: string;
  review?: boolean;
  storeContext?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigationContent = (
    <>
      <div className="flex h-topbar items-center px-5">
        <Brand />
      </div>
      <div className="mx-3 mb-5 flex items-center gap-2.5 rounded-md border border-border bg-surface/70 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-surface">
          <Store size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Merchant workspace</p>
          <p className="text-xs text-text-muted">No store selected</p>
        </div>
      </div>
      <nav aria-label="Main navigation" className="space-y-1 px-3">
        {navigation.map((item) => {
          const Icon = icons[item.icon];
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-10 items-center gap-2.5 rounded-sm px-3 text-[13px] transition-colors lg:min-h-9 ${active ? "bg-brand-subtle font-semibold text-brand" : "text-text-muted hover:bg-surface-subtle hover:text-text"}`}
            >
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-6 pb-5 pt-10">
        <p className="text-xs font-medium text-text-muted">Qafilah Merchant</p>
        {review && <p className="mt-1 text-xs text-text-muted">Interface foundation · F1</p>}
      </div>
    </>
  );
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="fixed start-4 top-3 z-50 -translate-y-20 rounded-sm bg-brand px-4 py-2 text-white focus:translate-y-0"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 start-0 z-20 hidden w-sidebar flex-col border-e border-border bg-sidebar lg:flex">
        {navigationContent}
      </aside>
      <div className="lg:ps-sidebar">
        <header className="sticky top-0 z-10 flex h-topbar items-center justify-between gap-3 border-b border-border bg-surface px-4 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
              <Dialog.Trigger asChild>
                <button
                  className="flex size-11 items-center justify-center rounded-sm hover:bg-surface-subtle lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu size={20} />
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-text/30" />
                <Dialog.Content className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col bg-background">
                  <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                  <Dialog.Description className="sr-only">
                    Navigate the Qafilah workspace.
                  </Dialog.Description>
                  <Dialog.Close asChild>
                    <button
                      aria-label="Close navigation"
                      className="absolute end-2 top-2 flex size-11 items-center justify-center rounded-sm hover:bg-surface-subtle"
                    >
                      <X size={18} />
                    </button>
                  </Dialog.Close>
                  {navigationContent}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <span className="hidden text-[13px] text-text-muted sm:inline">Merchant dashboard</span>
            <ChevronRight
              size={13}
              className="hidden text-text-muted sm:inline"
              aria-hidden="true"
            />
            <span className="truncate text-[13px] font-medium">{title}</span>
          </div>
          {storeContext ?? (
            <span className="flex items-center gap-2 text-xs text-text-muted">
              <span className="size-1.5 rounded-full bg-text-muted" />
              No store connected
            </span>
          )}
        </header>
        {review && (
          <div className="border-b border-border bg-surface-subtle px-5 py-2 text-xs text-text-muted lg:px-7">
            <span className="font-semibold text-text">Component review</span>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            Development only. Examples are not live store data.
          </div>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1260px] px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

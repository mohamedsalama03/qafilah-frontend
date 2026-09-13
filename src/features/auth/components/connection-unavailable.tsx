import { LockKeyhole, Unplug } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/layout/brand";

export function ConnectionUnavailable() {
  return (
    <main className="flex min-h-dvh flex-col px-5">
      <header className="mx-auto w-full max-w-6xl py-7">
        <Brand />
      </header>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pb-24">
        <span className="mb-5 flex size-11 items-center justify-center rounded-lg border border-border bg-surface">
          <LockKeyhole size={21} className="text-brand" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h1>
        <p className="mt-2 text-sm leading-6 text-text-muted">Manage your store with Qafilah.</p>
        <section
          aria-labelledby="connection-title"
          className="mt-7 rounded-md border border-border bg-surface p-5"
        >
          <div className="flex items-start gap-3">
            <Unplug size={18} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
            <div>
              <h2 id="connection-title" className="text-sm font-semibold">
                Sign-in is not available yet
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-text-muted">
                This dashboard hasn’t been connected to your store service. Contact your
                administrator to finish setting up access.
              </p>
            </div>
          </div>
        </section>
        <p className="mt-5 text-xs leading-5 text-text-muted">
          Your store’s information will appear after a secure connection is established.
        </p>
        {process.env.NODE_ENV === "development" && (
          <Link
            href="/design-system"
            prefetch={false}
            className="mt-8 self-start text-sm font-medium text-brand underline"
          >
            Open component review
          </Link>
        )}
      </div>
      <footer className="pb-6 text-center text-xs text-text-muted">
        Qafilah Merchant Dashboard
      </footer>
    </main>
  );
}

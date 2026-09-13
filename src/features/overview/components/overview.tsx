import { ArrowUpRight, ClipboardList, Package, Store, Unplug } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

export function Overview({ review = false }: { review?: boolean }) {
  return (
    <>
      <PageHeader title="Home" description="Your store’s day-to-day operations, in one place." />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Store overview</h2>
              <StatusBadge tone="neutral">Not connected</StatusBadge>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-subtle">
                  <Unplug size={20} className="text-text-muted" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-semibold">Your workspace starts with a store</h3>
                  <p className="mt-1.5 max-w-prose text-sm leading-6 text-text-muted">
                    Once connected, you’ll see the work that needs your attention. Your store’s
                    information stays private until access is confirmed.
                  </p>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 divide-x divide-border border-t border-border pt-4 rtl:divide-x-reverse">
                <div className="pe-4">
                  <p className="text-xs text-text-muted">Store access</p>
                  <p className="mt-1 text-sm font-medium">Waiting for connection</p>
                </div>
                <div className="ps-4">
                  <p className="text-xs text-text-muted">Latest activity</p>
                  <p className="mt-1 text-sm font-medium">Not available yet</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Recent work</h2>
            </CardHeader>
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <ClipboardList
                size={25}
                strokeWidth={1.5}
                className="text-text-muted"
                aria-hidden="true"
              />
              <h3 className="mt-3 text-sm font-medium">Nothing to show yet</h3>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-text-muted">
                Recent work will appear here when a store is connected. No activity is being loaded.
              </p>
            </div>
          </Card>
          {review && (
            <div className="rounded-md border border-border bg-surface px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Explore the interface patterns</h2>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    Review table, detail and form behavior with isolated examples.
                  </p>
                </div>
                <Link
                  href="/design-system/table"
                  prefetch={false}
                  className="inline-flex items-center gap-1.5 rounded-sm px-2 py-2 text-sm font-medium text-brand hover:bg-brand-subtle"
                >
                  View table pattern
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Store context</h2>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Store size={19} className="text-text-muted" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">No store selected</p>
                  <p className="mt-1 text-xs text-text-muted">Access hasn’t been established.</p>
                </div>
              </div>
              <div className="mt-5 border-t border-border pt-4 text-xs leading-5 text-text-muted">
                Available stores and actions are determined by your account’s access.
              </div>
            </CardContent>
          </Card>
          <section className="px-1">
            <h2 className="text-sm font-semibold">Built around your workflow</h2>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              A clear place for your everyday store operations.
            </p>
            <div className="mt-4 flex gap-2 text-xs leading-5 text-text-muted">
              <Package size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>Operational sections appear when they’re available to your store.</span>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

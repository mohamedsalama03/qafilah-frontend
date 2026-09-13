import { Package } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DetailLayout } from "@/components/ui/detail-layout";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

export function DetailPattern() {
  return (
    <>
      <PageHeader
        title="Everyday canvas tote"
        description="A representative detail layout. This is an isolated component example."
        status={<StatusBadge tone="success">Ready · example</StatusBadge>}
        breadcrumbs={[
          { label: "Sample records", href: "/design-system/table" },
          { label: "Detail pattern" },
        ]}
        primaryAction={
          <Link
            href="/design-system/form"
            prefetch={false}
            className="rounded-sm border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-surface-subtle"
          >
            View form pattern
          </Link>
        }
      />
      <DetailLayout
        sidebar={
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Record context</h2>
            </CardHeader>
            <CardContent>
              <dl className="space-y-4">
                <div>
                  <dt className="text-xs text-text-muted">Example reference</dt>
                  <dd className="mt-1 text-sm font-medium">EX-001</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">Category</dt>
                  <dd className="mt-1 text-sm">Accessories</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">Data source</dt>
                  <dd className="mt-1 text-sm">Development example</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        }
      >
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Record details</h2>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <Package
                  size={25}
                  strokeWidth={1.3}
                  aria-hidden="true"
                  className="text-text-muted"
                />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold">Everyday canvas tote</h3>
                <p className="mt-1.5 max-w-prose text-sm leading-6 text-text-muted">
                  A simple example showing how names, descriptions and secondary information fit
                  together on a compact detail page.
                </p>
              </div>
            </div>
            <dl className="mt-6 grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-text-muted">Reference</dt>
                <dd className="mt-1 text-sm">EX-001</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Example state</dt>
                <dd className="mt-1 text-sm">Ready</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Additional information</h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-text-muted">
              Supporting details belong next to the record they describe. Only information returned
              by the approved store service will appear in a connected workflow.
            </p>
          </CardContent>
        </Card>
        <section className="px-1">
          <h2 className="text-sm font-semibold">Activity</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            No activity source is connected. This pattern does not invent a timeline or audit
            history.
          </p>
        </section>
      </DetailLayout>
    </>
  );
}

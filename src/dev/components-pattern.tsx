"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Info, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Radio, Select } from "@/components/ui/form-controls";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { Toast } from "@/components/ui/toast";
import { ApiError, type ApiErrorKind } from "@/lib/api/errors";
import { ActionMenu } from "@/components/ui/action-menu";

const errorKinds: { value: ApiErrorKind; label: string; title: string }[] = [
  { value: "forbidden", label: "403 · Permission denied", title: "You don’t have access" },
  { value: "unauthenticated", label: "401 · Signed out", title: "Sign in to continue" },
  { value: "not-found", label: "404 · Not found", title: "Record not found" },
  { value: "conflict", label: "409 · Conflict", title: "This record has changed" },
  { value: "session-expired", label: "419 · Session expired", title: "Your session has expired" },
  { value: "validation", label: "422 · Validation", title: "Check your changes" },
  { value: "rate-limited", label: "429 · Rate limited", title: "Please wait before trying again" },
  {
    value: "server",
    label: "500 · Service error",
    title: "The service couldn’t complete the request",
  },
  { value: "network", label: "Network unavailable", title: "Unable to connect" },
  { value: "timeout", label: "Request timeout", title: "The request took too long" },
];

export function ComponentsPattern() {
  const [notice, setNotice] = useState<string | null>(null);
  const [kind, setKind] = useState<ApiErrorKind>("forbidden");
  const selectedError = errorKinds.find((item) => item.value === kind)!;
  return (
    <>
      <PageHeader
        title="Components & states"
        description="The shared visual language for Qafilah’s merchant workspace."
        primaryAction={
          <Link
            href="/design-system/login"
            className="rounded-sm border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-subtle"
          >
            Login pattern
          </Link>
        }
      />
      <Tabs defaultValue="components">
        <TabsList aria-label="Component review sections">
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="states">Loading & errors</TabsTrigger>
        </TabsList>
        <TabsContent value="components">
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Actions</h2>
                <span className="text-xs text-text-muted">Compact, consistent and explicit</span>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" onClick={() => setNotice("Primary action preview.")}>
                    <Plus size={15} aria-hidden="true" />
                    Primary action
                  </Button>
                  <Button onClick={() => setNotice("Secondary action preview.")}>Secondary</Button>
                  <Button variant="ghost" onClick={() => setNotice("Quiet action preview.")}>
                    Quiet action
                  </Button>
                  <Button disabled>Unavailable</Button>
                  <Button pending pendingLabel="Saving…">
                    Save
                  </Button>
                  <ActionMenu
                    label="Example resource actions"
                    actions={[
                      {
                        id: "inspect",
                        label: "Inspect example",
                        onSelect: () => setNotice("Inspect action preview. No store data changed."),
                      },
                      {
                        id: "clear",
                        label: "Clear example action",
                        destructive: true,
                        onSelect: () => setNotice("Clear action preview. No store data changed."),
                      },
                    ]}
                  />
                  <Tooltip content="An accessible icon-only control">
                    <IconButton
                      label="About this example"
                      onClick={() => setNotice("Icon controls include an accessible label.")}
                    >
                      <Info size={16} />
                    </IconButton>
                  </Tooltip>
                </div>
                <div className="mt-5 border-t border-border pt-5">
                  <ConfirmationDialog
                    trigger={<Button variant="danger">Open confirmation</Button>}
                    title="Clear this example?"
                    description="This demonstrates a deliberate confirmation. Only the component example is affected; no store data is changed."
                    confirmLabel="Clear example"
                    destructive
                    onConfirm={() =>
                      setNotice("Example confirmation completed. No store data changed.")
                    }
                  />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Status & selection</h2>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  <StatusBadge>Neutral</StatusBadge>
                  <StatusBadge tone="success">Ready</StatusBadge>
                  <StatusBadge tone="warning">Needs attention</StatusBadge>
                  <StatusBadge tone="danger">Unavailable</StatusBadge>
                  <StatusBadge tone="info">In progress</StatusBadge>
                </div>
                <fieldset className="mt-6 flex flex-wrap gap-5 border-t border-border pt-4">
                  <legend className="text-sm font-medium">Example view preference</legend>
                  <Radio
                    name="density-example"
                    value="comfortable"
                    label="Comfortable"
                    defaultChecked
                  />
                  <Radio name="density-example" value="compact" label="Compact" />
                </fieldset>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Empty state</h2>
              </CardHeader>
              <EmptyState
                icon={<Package size={25} />}
                title="No records to display"
                description="Useful context stays visible when a list has no results. A next action appears only when the workflow supports it."
              />
            </Card>
            <div className="flex items-center gap-2 px-1 text-xs text-text-muted">
              <Check size={14} aria-hidden="true" />
              These controls demonstrate presentation behavior only.
            </div>
          </div>
        </TabsContent>
        <TabsContent value="states">
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Error recovery</h2>
              </CardHeader>
              <div className="px-5 pt-5">
                <label htmlFor="error-kind" className="mb-2 block text-sm font-medium">
                  Preview error
                </label>
                <Select
                  id="error-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as ApiErrorKind)}
                >
                  {errorKinds.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </div>
              <ErrorState title={selectedError.title} description={new ApiError(kind).message} />
            </Card>
            <Card>
              <CardHeader>
                <h2 className="font-semibold">Loading a page</h2>
              </CardHeader>
              <CardContent>
                <PageSkeleton />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
      {notice && <Toast message={notice} onDismiss={() => setNotice(null)} />}
    </>
  );
}

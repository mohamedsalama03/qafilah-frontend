"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { FormError, FormField, Input, Textarea } from "@/components/ui/field";
import { Checkbox, Select } from "@/components/ui/form-controls";
import { PageHeader } from "@/components/ui/page-header";
import { Toast } from "@/components/ui/toast";
import { applyValidationErrors } from "@/lib/forms/apply-validation-errors";

// These rules validate a component example only; they are not Laravel domain rules.
const schema = z.object({
  name: z.string().trim().min(1, "Enter a name for this example."),
  reference: z.string().trim().min(1, "Enter an example reference."),
  description: z.string(),
  category: z.string(),
  enabled: z.boolean(),
});
type ExampleForm = z.infer<typeof schema>;
const initial: ExampleForm = {
  name: "",
  reference: "",
  description: "",
  category: "accessories",
  enabled: false,
};

export function FormPattern() {
  const form = useForm<ExampleForm>({ resolver: zodResolver(schema), defaultValues: initial });
  const [response, setResponse] = useState("confirm");
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    form.clearErrors();
    setMessage(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (response === "validation") {
        applyValidationErrors(
          form,
          { reference: ["This example reference is already in use."] },
          { name: "name", reference: "reference" },
          "Check the highlighted field.",
        );
      } else {
        setMessage("Preview validated. Nothing was sent or saved.");
      }
    } finally {
      submitting.current = false;
    }
  }
  return (
    <>
      <PageHeader
        title="Form pattern"
        description="A focused editing layout with inline errors and deliberate actions."
        breadcrumbs={[
          { label: "Sample records", href: "/design-system/table" },
          { label: "Form pattern" },
        ]}
      />
      <form
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
        noValidate
        className="max-w-3xl space-y-5"
      >
        <FormError message={form.formState.errors.root?.server?.message} />
        <Card>
          <CardHeader>
            <div>
              <h2 className="font-semibold">Record information</h2>
              <p className="mt-1 text-xs text-text-muted">
                This example is for interface review. No store information is changed.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              <FormField
                id="record-name"
                label="Name"
                required
                error={form.formState.errors.name?.message}
              >
                <Input
                  {...form.register("name")}
                  autoComplete="off"
                  placeholder="e.g. Everyday canvas tote"
                />
              </FormField>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  id="record-reference"
                  label="Reference"
                  required
                  description="A short label for this example."
                  error={form.formState.errors.reference?.message}
                >
                  <Input
                    {...form.register("reference")}
                    autoComplete="off"
                    placeholder="e.g. EX-011"
                  />
                </FormField>
                <FormField id="record-category" label="Category">
                  <Select {...form.register("category")}>
                    <option value="accessories">Accessories</option>
                    <option value="home">Home & living</option>
                    <option value="workspace">Workspace</option>
                  </Select>
                </FormField>
              </div>
              <FormField
                id="record-description"
                label="Description"
                description="Keep supporting information clear and useful."
              >
                <Textarea
                  {...form.register("description")}
                  placeholder="Add a short description"
                  rows={4}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Checkbox
              {...form.register("enabled")}
              label="Include in the preview"
              description="Demonstrates an optional checkbox. This does not publish a product."
            />
          </CardContent>
        </Card>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
          <div className="flex items-center gap-2">
            <label htmlFor="form-response" className="text-xs text-text-muted">
              Preview response
            </label>
            <Select
              id="form-response"
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              disabled={form.formState.isSubmitting}
              className="w-40"
            >
              <option value="confirm">Confirmation</option>
              <option value="validation">Field error</option>
            </Select>
          </div>
          <div className="flex gap-2">
            <ConfirmationDialog
              trigger={
                <Button disabled={!form.formState.isDirty || form.formState.isSubmitting}>
                  Reset example
                </Button>
              }
              title="Reset this example?"
              description="Your edits to this component example will be cleared. No store information is affected."
              confirmLabel="Reset example"
              onConfirm={() => {
                form.reset(initial);
                setMessage(null);
              }}
            />
            <Button
              type="submit"
              variant="primary"
              pending={form.formState.isSubmitting}
              pendingLabel="Validating…"
            >
              Validate preview
            </Button>
          </div>
        </div>
      </form>
      {message && <Toast message={message} onDismiss={() => setMessage(null)} />}
    </>
  );
}

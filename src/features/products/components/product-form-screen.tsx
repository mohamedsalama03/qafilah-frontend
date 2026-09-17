"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonStyles } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/form-controls";
import { FormError, FormField, Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/error-state";
import { useStores } from "@/features/stores/components/store-provider";
import { useUnsavedProductChanges } from "@/lib/forms/unsaved-changes";
import { ApiError } from "@/lib/api/errors";
import type { MerchantProduct } from "../contracts";
import { catalogUuidSchema, categoryCriteriaSchema } from "../model";
import { createProductPayloadSchema, productUpdateChanges } from "../mutation-model";
import { useProductMutation } from "../mutations";
import { useProduct, useProductCategories } from "../queries";
import { CatalogError, ProductAccess, ProductLoading, RefreshAccess } from "./product-shared";
import { MutationFeedback } from "./mutation-feedback";

function FormSection({
  title,
  children,
  description,
}: {
  title: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-5 sm:p-6">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function ManagementAccess({ create, children }: { create?: boolean; children: ReactNode }) {
  const { state } = useStores();
  const permission = create ? "products.create" : "products.update";
  if (!state.context?.permissions.includes(permission))
    return (
      <>
        <PageHeader title={create ? "Create product" : "Edit product"} />
        <ErrorState
          title="Product management is unavailable"
          description="Your current store access does not include this action."
        />
        <RefreshAccess />
      </>
    );
  return children;
}

function CategoryAssignment({
  ids,
  onChange,
  disabled,
  error,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  error?: string;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const query = useProductCategories(categoryCriteriaSchema.parse({ per_page: 100 }), cursor);
  const page = query.error || query.isFetching ? undefined : query.data;
  return (
    <FormSection
      title="Categories"
      description="Select up to 20 categories. Saving replaces the full assignment set."
    >
      {error && (
        <p id="category_ids-error" className="text-sm text-danger">
          {error}
        </p>
      )}
      {query.error ? (
        <CatalogError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
          restart={() => setCursor(null)}
        />
      ) : !page ? (
        <p role="status" className="text-sm text-text-muted">
          Loading categories…
        </p>
      ) : (
        <>
          <fieldset
            id="category_ids"
            tabIndex={-1}
            className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            aria-invalid={!!error}
            aria-describedby={error ? "category_ids-error" : undefined}
            disabled={disabled}
          >
            <legend className="sr-only">Product categories</legend>
            {page.categories.length ? (
              <div className="max-h-64 overflow-y-auto">
                {page.categories.map((category) => (
                  <Checkbox
                    key={category.id}
                    label={category.name}
                    description={category.status === "hidden" ? "Hidden category" : undefined}
                    checked={ids.includes(category.id)}
                    disabled={disabled || (!ids.includes(category.id) && ids.length >= 20)}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...ids, category.id]
                          : ids.filter((id) => id !== category.id),
                      )
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">No categories available.</p>
            )}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span>{ids.length} of 20 selected</span>
            {ids.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onChange([])}
              >
                Clear categories
              </Button>
            )}
          </div>
          {(page.pagination.previous_cursor || page.pagination.next_cursor) && (
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={disabled || !page.pagination.previous_cursor}
                onClick={() => setCursor(page.pagination.previous_cursor)}
              >
                Previous categories
              </Button>
              <Button
                type="button"
                disabled={disabled || !page.pagination.next_cursor}
                onClick={() => setCursor(page.pagination.next_cursor)}
              >
                Next categories
              </Button>
            </div>
          )}
        </>
      )}
    </FormSection>
  );
}

function valuesFor(product?: MerchantProduct) {
  return {
    name: product?.name ?? "",
    slug: product?.slug ?? "",
    description: product?.description ?? "",
    seo_title: product?.seo_title ?? "",
    seo_description: product?.seo_description ?? "",
    category_ids: product?.categories.map((category) => category.id) ?? [],
    type: product?.type ?? "simple",
    requires_shipping: product?.requires_shipping ?? true,
  };
}

function CreateProductForm() {
  const mutation = useProductMutation();
  return <ProductFormFields key={mutation.state.slot} mutation={mutation} />;
}

function ProductFormFields({
  product,
  mutation,
}: {
  product?: MerchantProduct;
  mutation: ReturnType<typeof useProductMutation>;
}) {
  const { state } = useStores();
  const router = useRouter();
  const [source, setSource] = useState(product);
  const [values, setValues] = useState(() => valuesFor(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(valuesFor(source));
  const completed = useUnsavedProductChanges(
    dirty,
    mutation.isPending && mutation.state.status !== "reviewing",
  );
  const href = `/stores/${state.scope!.storeUuid}/products`;
  const categoryAccess = state.context!.permissions.includes("categories.view");
  const canView = state.context!.permissions.includes("products.view");
  const returnHref = canView ? href : `/stores/${state.scope!.storeUuid}`;
  const create = !source;
  const busy = mutation.isBlocked;
  const serverErrors =
    mutation.state.status === "error" ? mutation.state.error?.fieldErrors : undefined;
  const errorFor = (field: string) =>
    errors[field] ??
    serverErrors?.[field]?.[0] ??
    (field === "category_ids"
      ? Object.entries(serverErrors ?? {}).find(([key]) => key.startsWith("category_ids."))?.[1][0]
      : undefined);
  useEffect(() => {
    if (validationAttempt || mutation.state.error?.kind === "validation")
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [validationAttempt, mutation.state.error]);
  function textChange(
    field: "name" | "slug" | "description" | "seo_title" | "seo_description",
    value: string,
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setNotice("");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setNotice("");
    const { category_ids, ...fields } = values;
    const parsed = createProductPayloadSchema.safeParse({
      ...fields,
      seo_title: values.seo_title.trim() ? values.seo_title : null,
      seo_description: values.seo_description.trim() ? values.seo_description : null,
      ...(categoryAccess ? { category_ids } : {}),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "product");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    setErrors({});
    let result: MerchantProduct | null;
    if (source) {
      const candidate = { ...parsed.data };
      delete candidate.type;
      const data = productUpdateChanges(source, candidate);
      if (!data) {
        setNotice("There are no changes to save.");
        return;
      }
      result = await mutation.execute({ action: "update", data });
    } else result = await mutation.execute({ action: "create", data: parsed.data });
    if (result) {
      if (canView) {
        completed();
        router.push(`${href}/${result.id}`);
      } else completed();
    }
  }
  async function reconcile() {
    const result = await mutation.reconcile();
    if (!result) return;
    if ("products" in result) {
      completed();
      router.push(href);
    } else {
      setSource(result);
      setValues(valuesFor(result));
      setErrors({});
      setNotice("Latest product loaded. Review it before making another change.");
    }
  }
  if (source?.status === "archived")
    return (
      <>
        <PageHeader title="Edit product" />
        <ErrorState
          title="This product is archived"
          description="Archived products cannot be edited or restored."
        />
        <Link href={`${href}/${source.id}`} className={buttonStyles()}>
          Back to product
        </Link>
      </>
    );
  if (mutation.state.status === "success" || mutation.state.status === "reviewing")
    return (
      <>
        <PageHeader
          title={
            create
              ? "Product created"
              : mutation.state.action === "update"
                ? "Product saved"
                : "Product updated"
          }
          description={
            create
              ? `${mutation.state.product!.name} was saved as a draft.`
              : "Your changes have been saved."
          }
        />
        <p role="status" className="mb-5 text-sm text-text-muted">
          {create
            ? canView
              ? "This completed submission cannot be sent again. View the product or start a fresh blank product."
              : "Your access allows creating products. Viewing or editing this product requires additional access."
            : "The previous change is complete. Start a new edit to review the latest details before making another change."}
        </p>
        <div className="flex flex-wrap gap-2">
          {create ? (
            <Button
              variant="primary"
              onClick={() => {
                if (mutation.startAnotherCreate()) router.replace(`${href}/new`);
              }}
            >
              Create another product
            </Button>
          ) : (
            <Button
              pending={mutation.state.status === "reviewing"}
              pendingLabel="Reviewing…"
              onClick={() => {
                // This explicit navigation supersedes any earlier detail transition.
                // Do not navigate after the review: the merchant may leave while it runs.
                router.replace(`${href}/${mutation.state.product!.id}/edit`);
                void mutation.reviewSuccess();
              }}
            >
              Start a new edit
            </Button>
          )}
          <Link
            href={canView ? `${href}/${mutation.state.product!.id}` : returnHref}
            prefetch={false}
            className={buttonStyles()}
          >
            {canView ? "View product" : "Back to overview"}
          </Link>
        </div>
        {mutation.state.error && (
          <div className="mt-4">
            <FormError
              message={`The change was saved, but the latest product could not be reviewed. ${mutation.state.error.message}`}
            />
          </div>
        )}
      </>
    );
  return (
    <>
      <PageHeader
        title={create ? "Create product" : "Edit product"}
        description={create ? "Add the details for a new draft product." : source?.name}
        breadcrumbs={[
          { label: canView ? "Products" : "Overview", href: returnHref },
          ...(source ? [{ label: "Product details", href: `${href}/${source.id}` }] : []),
          { label: create ? "Create product" : "Edit product" },
        ]}
        secondaryActions={<RefreshAccess />}
      />
      <form
        ref={form}
        onSubmit={submit}
        noValidate
        className="max-w-5xl space-y-5"
        aria-busy={mutation.isPending}
      >
        <MutationFeedback
          mutation={mutation}
          create={create}
          canReview={canView}
          startSeparateCreate={() => {
            if (mutation.startSeparateCreate()) {
              setValues(valuesFor());
              setErrors({});
              setNotice("A new blank product form is ready. No earlier request has been repeated.");
            }
          }}
          reconcile={() => {
            void reconcile();
          }}
        />
        {errors.product && <FormError message={errors.product} />}
        {notice && (
          <p role="status" className="text-sm text-text-muted">
            {notice}
          </p>
        )}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)]">
          <div className="min-w-0 space-y-5">
            <FormSection title="Product details">
              <FormField id="name" label="Product name" required error={errorFor("name")}>
                <Input
                  autoComplete="off"
                  value={values.name}
                  disabled={busy}
                  onChange={(event) => textChange("name", event.target.value)}
                />
              </FormField>
              <FormField
                id="slug"
                label="Slug"
                required
                description="2–160 lowercase letters, numbers and single hyphens."
                error={errorFor("slug")}
              >
                <Input
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={values.slug}
                  disabled={busy}
                  onChange={(event) => textChange("slug", event.target.value)}
                />
              </FormField>
              <FormField
                id="description"
                label="Description"
                required
                description="Plain text, up to 5,000 characters. Line breaks are preserved."
                error={errorFor("description")}
              >
                <Textarea
                  rows={7}
                  value={values.description}
                  disabled={busy}
                  onChange={(event) => textChange("description", event.target.value)}
                />
              </FormField>
            </FormSection>
            <FormSection
              title="Search engine listing"
              description="Optional. Leave a field empty to clear it."
            >
              <FormField
                id="seo_title"
                label="SEO title"
                description="Up to 70 characters."
                error={errorFor("seo_title")}
              >
                <Input
                  value={values.seo_title}
                  disabled={busy}
                  onChange={(event) => textChange("seo_title", event.target.value)}
                />
              </FormField>
              <FormField
                id="seo_description"
                label="SEO description"
                description="Up to 320 characters."
                error={errorFor("seo_description")}
              >
                <Textarea
                  value={values.seo_description}
                  disabled={busy}
                  onChange={(event) => textChange("seo_description", event.target.value)}
                />
              </FormField>
            </FormSection>
          </div>
          <div className="min-w-0 space-y-5">
            <FormSection title="Organization">
              {create ? (
                <FormField
                  id="type"
                  label="Product type"
                  error={errorFor("type")}
                  description="Product type cannot be changed after creation."
                >
                  <Select
                    value={values.type}
                    disabled={busy}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        type: event.target.value as "simple" | "variant",
                      }))
                    }
                  >
                    <option value="simple">Simple product</option>
                    <option value="variant">Variant product</option>
                  </Select>
                </FormField>
              ) : (
                <div className="text-sm">
                  <p className="text-xs text-text-muted">Product type</p>
                  <p className="mt-1">
                    {source.type === "simple" ? "Simple product" : "Variant product"}
                  </p>
                </div>
              )}
              {values.type === "variant" && (
                <p className="text-xs leading-5 text-text-muted">
                  Variant configuration is not available in this workspace yet. This creates the
                  product only.
                </p>
              )}
              <Checkbox
                id="requires_shipping"
                label="Requires shipping"
                checked={values.requires_shipping}
                disabled={busy}
                onChange={(event) =>
                  setValues((current) => ({ ...current, requires_shipping: event.target.checked }))
                }
              />
              {errorFor("requires_shipping") && (
                <FormError message={errorFor("requires_shipping")} />
              )}
            </FormSection>
            {categoryAccess && (
              <CategoryAssignment
                ids={values.category_ids}
                disabled={busy}
                error={errorFor("category_ids")}
                onChange={(category_ids) => setValues((current) => ({ ...current, category_ids }))}
              />
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
          <p className="max-w-prose text-xs leading-5 text-text-muted">
            {create
              ? "New products are saved as drafts."
              : "Saving applies your changed fields to the latest product. Another editor’s changes to those fields may be overwritten."}
          </p>
          <div className="flex gap-2">
            <Link
              href={source ? `${href}/${source.id}` : returnHref}
              prefetch={false}
              className={buttonStyles()}
            >
              Cancel
            </Link>
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              pending={mutation.state.status === "pending"}
              pendingLabel="Saving…"
            >
              {create ? "Create product" : "Save changes"}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}

function EditProduct({ productUuid }: { productUuid: string }) {
  // Read the query in the same render that renews the slot. A separate child can
  // otherwise remount with old props before the query's notification is delivered.
  const mutation = useProductMutation(productUuid);
  const query = useProduct(productUuid, { refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (query.error)
    return (
      <>
        <PageHeader title="Edit product" />
        <CatalogError
          error={query.error}
          detail
          retry={() => {
            void query.refetch();
          }}
        />
      </>
    );
  if (!query.data || query.isFetching) return <ProductLoading detail />;
  return <ProductFormFields key={mutation.state.slot} mutation={mutation} product={query.data} />;
}

export function CreateProductScreen() {
  return (
    <ManagementAccess create>
      <CreateProductForm />
    </ManagementAccess>
  );
}
export function EditProductScreen({ productUuid }: { productUuid: string }) {
  const parsed = catalogUuidSchema.safeParse(productUuid);
  return (
    <ProductAccess>
      <ManagementAccess>
        {parsed.success ? (
          <EditProduct key={parsed.data} productUuid={parsed.data} />
        ) : (
          <CatalogError error={new ApiError("not-found")} detail retry={() => {}} />
        )}
      </ManagementAccess>
    </ProductAccess>
  );
}

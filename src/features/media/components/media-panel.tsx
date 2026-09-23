"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { FormError } from "@/components/ui/field";
import { useStores } from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "@/features/products/contracts";
import type { MerchantVariant } from "@/features/variants/contracts";
import { normalizeUnexpectedError } from "@/lib/api/errors";
import { parsePublicEnvironment } from "@/lib/env";
import { resolveMediaUrl } from "@/lib/media-url";
import type { MerchantMedia, MediaTarget } from "../contracts";
import { maximumProductMedia, maximumVariantMedia, mediaPermissions } from "../model";
import { useMediaMutation } from "../mutations";
import { useMedia } from "../queries";
import { MediaForm } from "./media-form";

function MediaThumbnail({ media }: { media: MerchantMedia }) {
  const [failed, setFailed] = useState(false);
  let src: string | null = null;
  try {
    const { apiOrigin } = parsePublicEnvironment(
      { NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN },
      process.env.NODE_ENV,
    );
    if (apiOrigin) src = resolveMediaUrl(media.url, apiOrigin, process.env.NODE_ENV);
  } catch {
    /* Invalid configuration or returned paths never reach an image request. */
  }
  return (
    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-surface-subtle">
      {src && !failed ? (
        <Image
          unoptimized
          src={src}
          alt={media.alt_text ?? ""}
          width={media.width}
          height={media.height}
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="text-xs text-text-muted">Image unavailable</span>
      )}
    </div>
  );
}

type MediaMutation = ReturnType<typeof useMediaMutation>;
function MediaActions({
  collection,
  mutation,
  disabled,
  archived,
  limit,
}: {
  collection: readonly MerchantMedia[];
  mutation: MediaMutation;
  disabled: boolean;
  archived: boolean;
  limit: number;
}) {
  const { state } = useStores();
  const [editor, setEditor] = useState<"upload" | MerchantMedia | null>(null);
  const actionRoot = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const permissions = state.context?.permissions ?? [];
  const can = (action: "create" | "update" | "delete") =>
    !archived && permissions.includes(mediaPermissions[action]);
  const confirmed = ["success", "reviewing"].includes(mutation.state.status);
  const unknown = ["unknown", "reconciling"].includes(mutation.state.status);
  const locked = disabled || mutation.isBlocked;
  const visibleEditor =
    editor && !confirmed && !unknown && can(editor === "upload" ? "create" : "update");
  // This component is remounted for every consumed/reviewed slot; it never retains an old File or intent.
  const cancel = () => {
    setEditor(null);
    requestAnimationFrame(() =>
      (returnFocus.current?.isConnected
        ? returnFocus.current
        : actionRoot.current?.querySelector<HTMLButtonElement>("button:not([disabled])")
      )?.focus(),
    );
  };
  return (
    <div ref={actionRoot} className="space-y-4">
      {collection.length ? (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {collection.map((media, index) => (
            <li key={media.id} aria-label={`Image ${index + 1}`} className="min-w-0 space-y-3">
              <MediaThumbnail key={media.url} media={media} />
              <div className="space-y-1 text-sm">
                <p className="break-words">
                  {media.alt_text ?? <span className="text-text-muted">No alt text</span>}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <span>Position {media.position}</span>
                  {"is_primary" in media && media.is_primary && (
                    <span className="rounded bg-surface-subtle px-2 py-0.5 font-medium text-text">
                      Primary
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {can("update") && (
                  <Button
                    disabled={locked || !!visibleEditor}
                    onClick={(event) => {
                      returnFocus.current = event.currentTarget;
                      setEditor(media);
                    }}
                  >
                    Edit image
                  </Button>
                )}
                {can("delete") && (
                  <ConfirmationDialog
                    privateContent
                    destructive
                    title="Delete image?"
                    description="This permanently deletes this image. You can upload a new image later."
                    confirmLabel="Delete image"
                    trigger={
                      <Button variant="ghost" disabled={locked || !!visibleEditor}>
                        Delete image
                      </Button>
                    }
                    onConfirm={async () => {
                      if (locked) return;
                      await mutation.execute({ operation: "delete", mediaUuid: media.id });
                    }}
                  />
                )}
                {can("update") && "is_primary" in media && !media.is_primary && (
                  <Button
                    variant="link"
                    disabled={locked || !!visibleEditor}
                    onClick={() =>
                      void mutation.execute({
                        operation: "update",
                        mediaUuid: media.id,
                        data: { is_primary: true },
                      })
                    }
                  >
                    Set as primary
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-text-muted">No images yet.</p>
      )}
      {visibleEditor ? (
        <MediaForm
          key={editor === "upload" ? "upload" : editor!.id}
          media={editor === "upload" ? undefined : editor!}
          mutation={mutation}
          disabled={disabled}
          onCancel={cancel}
        />
      ) : (
        can("create") &&
        !confirmed &&
        !unknown && (
          <div className="space-y-2">
            <Button
              disabled={locked || collection.length >= limit}
              onClick={(event) => {
                returnFocus.current = event.currentTarget;
                setEditor("upload");
              }}
            >
              Upload image
            </Button>
            {collection.length >= limit && (
              <p className="text-xs text-text-muted">
                Image limit reached. Delete an image before uploading another.
              </p>
            )}
          </div>
        )
      )}
    </div>
  );
}

function MediaFeedback({
  mutation,
  productReadFailed,
}: {
  mutation: MediaMutation;
  productReadFailed: boolean;
}) {
  const { state } = mutation;
  const feedback = useRef<HTMLDivElement>(null);
  const unknown = state.status === "unknown" || state.status === "reconciling";
  const confirmed = state.status === "success" || state.status === "reviewing";
  const fieldError =
    state.status === "error" &&
    ["image", "alt_text", "position"].some((name) => state.error?.fieldErrors[name]?.length);
  useEffect(() => {
    if (
      !fieldError &&
      (state.status === "success" ||
        state.status === "unknown" ||
        state.status === "error" ||
        state.guidance)
    )
      feedback.current?.focus();
  }, [fieldError, state.status, state.guidance, state.slot]);
  return (
    <div
      ref={feedback}
      tabIndex={-1}
      className="space-y-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {unknown && (
        <div role="alert" className="space-y-2 text-sm leading-6">
          <p className="font-medium">The result of this image change is unknown.</p>
          <p className="max-w-prose text-text-muted">
            It may already have taken effect. Review the current images before making a new change.
            Your earlier request will not be repeated.
          </p>
          {state.error && state.status === "unknown" && (
            <p className="text-text-muted">{state.error.message}</p>
          )}
        </div>
      )}
      {confirmed && (
        <div className="space-y-2 text-sm leading-6">
          <p role="status" className="font-medium">
            {state.operation === "create"
              ? "Image uploaded."
              : state.operation === "delete"
                ? "Image deleted."
                : "Image updated."}
          </p>
          {(state.refreshError || productReadFailed) && (
            <p className="max-w-prose text-text-muted">
              The change is confirmed, but the latest image or product details could not be loaded.
              Review current images before making another change.
            </p>
          )}
        </div>
      )}
      {(unknown || confirmed) && (
        <Button
          pending={state.status === "reconciling" || state.status === "reviewing"}
          pendingLabel="Reviewing images…"
          onClick={() => void (unknown ? mutation.reconcile() : mutation.reviewSuccess())}
        >
          Review current images
        </Button>
      )}
      {state.guidance && state.status === "idle" && (
        <p role="status" className="max-w-prose text-sm leading-6 text-text-muted">
          Current images reviewed.{" "}
          {state.reviewedUnknown &&
            "This shows current state; it does not prove whether the earlier request took effect. "}
          Choose a new change to continue. No earlier request has been repeated.
        </p>
      )}
      {state.status === "error" && state.error && (
        <FormError
          message={[
            state.error.message,
            ...state.error.formErrors,
            ...Object.entries(state.error.fieldErrors)
              .filter(([name]) => !["image", "alt_text", "position"].includes(name))
              .flatMap(([, messages]) => messages),
          ].join(" ")}
        />
      )}
    </div>
  );
}

interface MediaPanelProps {
  product: MerchantProduct;
  variant?: MerchantVariant;
  productReadPending?: boolean;
  productReadFailed?: boolean;
}
function ScopedMediaPanel({
  product,
  variant,
  productReadPending = false,
  productReadFailed = false,
}: MediaPanelProps) {
  const { state: stores } = useStores();
  const target: MediaTarget = variant
    ? { kind: "variant", productUuid: product.id, variantUuid: variant.id }
    : { kind: "product", productUuid: product.id };
  const query = useMedia(target);
  const mutation = useMediaMutation(product, variant);
  const { state } = mutation;
  const readError = query.error ? normalizeUnexpectedError(query.error) : null;
  const canRetainCollection =
    !readError || ["network", "timeout", "server", "rate-limited"].includes(readError.kind);
  // A later scoped GET supersedes the collection captured by a previous review.
  // Authority and decoding failures remove private thumbnails while confirmed feedback survives.
  const collection = canRetainCollection ? (query.data ?? state.collection) : undefined;
  const archived = product.status === "archived" || state.product?.status === "archived";
  const unknown = state.status === "unknown" || state.status === "reconciling";
  const confirmed = state.status === "success" || state.status === "reviewing";
  const permissions = stores.context?.permissions ?? [];
  const writable = [mediaPermissions.create, mediaPermissions.update, mediaPermissions.delete].some(
    (permission) => permissions.includes(permission),
  );
  const limit = variant ? maximumVariantMedia : maximumProductMedia;
  const Heading = variant ? "h3" : "h2";
  return (
    <section
      aria-label={variant ? "Variant images" : "Product images"}
      className={
        variant
          ? "mt-6 space-y-4 border-t border-border pt-5"
          : "mb-5 space-y-4 rounded-lg border border-border bg-surface p-5 sm:p-6"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading className="text-base font-semibold">Images</Heading>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {variant ? "Images for this variant." : "The primary image represents this product."} Up
            to {limit} images.
          </p>
        </div>
        {collection && (
          <p className="text-xs text-text-muted">
            {unknown || query.error ? "Last known: " : ""}
            {collection.length} / {limit} images
          </p>
        )}
      </div>
      {!collection && !query.error && (
        <p role="status" className="text-sm">
          Loading images…
        </p>
      )}
      {query.error && !unknown && !confirmed && (
        <div className="space-y-3">
          <FormError message={normalizeUnexpectedError(query.error).message} />
          <Button onClick={() => void query.refetch()} pending={query.isFetching}>
            Refresh images
          </Button>
        </div>
      )}
      <MediaFeedback mutation={mutation} productReadFailed={productReadFailed} />
      {collection && (
        <MediaActions
          key={state.slot}
          collection={collection}
          mutation={mutation}
          archived={archived}
          limit={limit}
          disabled={productReadPending || productReadFailed || query.isFetching || !!query.error}
        />
      )}
      {archived ? (
        <p className="text-xs text-text-muted">Archived product images cannot be changed.</p>
      ) : !writable ? (
        <p className="text-xs text-text-muted">Your current access allows viewing images only.</p>
      ) : null}
    </section>
  );
}

export function MediaPanel(props: MediaPanelProps) {
  const { state } = useStores();
  const permissions = state.context?.permissions ?? [];
  if (
    !state.scope ||
    !permissions.includes("products.view") ||
    !permissions.includes(mediaPermissions.view) ||
    (props.variant && !permissions.includes("products.variants.view"))
  )
    return null;
  const key = JSON.stringify([
    state.scope.principalId,
    state.scope.storeUuid,
    state.scope.revision,
    props.product.id,
    props.variant ? "variant" : "product",
    props.variant?.id,
  ]);
  return <ScopedMediaPanel key={key} {...props} />;
}

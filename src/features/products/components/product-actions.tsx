"use client";

import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useStores } from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "../contracts";
import { useProductMutation } from "../mutations";
import { allowsProductTransition } from "../mutation-model";
import { MutationFeedback } from "./mutation-feedback";

export function ProductActions({ product }: { product: MerchantProduct }) {
  const { state } = useStores();
  const mutation = useProductMutation(product.id);
  const permissions = state.context!.permissions;
  const update = permissions.includes("products.update");
  const publish = permissions.includes("products.publish");
  if (product.status === "archived")
    return (
      <p className="mb-5 text-sm text-text-muted">
        This product is archived. Editing and restoring archived products are unavailable.
      </p>
    );
  if (!update && !publish) return null;
  return (
    <div className="mb-6 space-y-3">
      <div aria-label="Product actions" className="flex flex-wrap gap-2">
        {update && !mutation.isBlocked && (
          <Link
            href={`/stores/${state.scope!.storeUuid}/products/${product.id}/edit`}
            prefetch={false}
            className={buttonStyles({ variant: "primary" })}
          >
            Edit
          </Link>
        )}
        {publish && allowsProductTransition(product.status, "publish") && (
          <Button
            disabled={mutation.isBlocked}
            pending={mutation.state.status === "pending" && mutation.state.action === "publish"}
            onClick={() => {
              void mutation.execute({ action: "publish" });
            }}
          >
            Publish
          </Button>
        )}
        {publish && allowsProductTransition(product.status, "unpublish") && (
          <Button
            disabled={mutation.isBlocked}
            pending={mutation.state.status === "pending" && mutation.state.action === "unpublish"}
            onClick={() => {
              void mutation.execute({ action: "unpublish" });
            }}
          >
            Unpublish
          </Button>
        )}
        {update && allowsProductTransition(product.status, "archive") && (
          <ConfirmationDialog
            privateContent
            trigger={<Button disabled={mutation.isBlocked}>Archive product</Button>}
            title="Archive product"
            description="This product will be archived and can no longer be edited or published. There is currently no way to restore it."
            confirmLabel="Archive product"
            destructive
            onConfirm={async () => {
              await mutation.execute({ action: "archive" });
            }}
          />
        )}
      </div>
      <MutationFeedback mutation={mutation} />
      {mutation.state.status === "success" && (
        <p role="status" className="text-sm text-text-muted">
          Product updated.
        </p>
      )}
    </div>
  );
}

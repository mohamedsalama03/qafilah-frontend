"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormField, Input } from "@/components/ui/field";
import type { MerchantMedia } from "../contracts";
import { normalizeMediaAltText, parseMediaPosition, validateMediaImage } from "../model";
import type { useMediaMutation } from "../mutations";

export function MediaForm({
  media,
  mutation,
  disabled,
  onCancel,
}: {
  media?: MerchantMedia;
  mutation: ReturnType<typeof useMediaMutation>;
  disabled: boolean;
  onCancel: () => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState(media?.alt_text ?? "");
  const [position, setPosition] = useState(String(media?.position ?? 0));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const server = mutation.state.status === "error" ? mutation.state.error?.fieldErrors : undefined;
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  useEffect(() => {
    if (server) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [server]);
  const submit = () => {
    if (disabled || mutation.isBlocked) return;
    const next: Record<string, string> = {};
    let image: File | undefined;
    let altText: string | null = null;
    let order = 0;
    if (!media) {
      try {
        image = validateMediaImage(file.current?.files?.[0] as File);
      } catch {
        next.image = "Choose a JPEG, PNG, or WebP image from 1 byte to 5 MiB.";
      }
    }
    try {
      altText = normalizeMediaAltText(alt);
    } catch {
      next.alt_text = "Use a single line of up to 250 characters, or leave blank.";
    }
    try {
      order = parseMediaPosition(position);
    } catch {
      next.position = "Enter a whole number from 0 to 10,000.";
    }
    setErrors(next);
    if (Object.keys(next).length) {
      const name = ["image", "alt_text", "position"].find((field) => next[field]);
      form.current?.querySelector<HTMLInputElement>(`[name="${name}"]`)?.focus();
      return;
    }
    if (media) {
      const data = {
        ...(altText !== media.alt_text ? { alt_text: altText } : {}),
        ...(order !== media.position ? { position: order } : {}),
      };
      if (!Object.keys(data).length) {
        setErrors({ form: "Change the alt text or position before saving." });
        form.current?.querySelector<HTMLInputElement>('[name="alt_text"]')?.focus();
        return;
      }
      void mutation.execute({ operation: "update", mediaUuid: media.id, data });
    } else if (image) {
      void mutation.execute({
        operation: "create",
        data: { image, alt_text: altText, position: order },
      });
    }
  };
  const locked = disabled || mutation.isBlocked;
  return (
    <form
      ref={form}
      aria-label={media ? "Edit image" : "Upload image"}
      noValidate
      className="space-y-4 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h4 className="text-sm font-semibold">{media ? "Edit image details" : "Upload an image"}</h4>
      {!media && (
        <FormField
          id={`${id}-image`}
          label="Image"
          required
          description="JPEG, PNG, or WebP. Up to 5 MiB, 8,000 pixels per side and 40 million pixels total."
          error={errors.image ?? server?.image?.[0]}
        >
          <Input
            ref={file}
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={locked}
            onChange={() => setErrors({})}
            className="file:me-3 file:font-medium"
          />
        </FormField>
      )}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <FormField
          id={`${id}-alt`}
          label="Alt text"
          description="Describe the image for people who cannot see it. Leave blank to clear."
          error={errors.alt_text ?? server?.alt_text?.[0]}
        >
          <Input
            name="alt_text"
            value={alt}
            disabled={locked}
            autoComplete="off"
            onChange={(event) => {
              setAlt(event.target.value);
              setErrors({});
            }}
          />
        </FormField>
        <FormField
          id={`${id}-position`}
          label="Position"
          description="0 to 10,000. Lower comes first."
          required
          error={errors.position ?? server?.position?.[0]}
        >
          <Input
            name="position"
            value={position}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            disabled={locked}
            onChange={(event) => {
              setPosition(event.target.value);
              setErrors({});
            }}
          />
        </FormField>
      </div>
      <FormError message={errors.form} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={locked}
          pending={mutation.state.status === "pending"}
          pendingLabel={media ? "Saving image…" : "Uploading image…"}
        >
          {media ? "Save image" : "Upload image"}
        </Button>
        <Button disabled={mutation.isPending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

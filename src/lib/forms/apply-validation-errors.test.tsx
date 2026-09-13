import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { FormError, FormField, Input } from "@/components/ui/field";
import { applyValidationErrors } from "@/lib/forms/apply-validation-errors";

function ValidationExample() {
  const form = useForm<{ title: string; reference: string }>({
    defaultValues: { title: "", reference: "" },
  });
  return (
    <form
      onSubmit={form.handleSubmit(() => {
        applyValidationErrors(
          form,
          {
            reference_code: ["Reference is already in use."],
            display_title: ["Enter a title."],
            domain: ["This example cannot be changed."],
          },
          { display_title: "title", reference_code: "reference" },
        );
      })}
    >
      <FormField
        id="title"
        label="Title"
        description="A short example title."
        error={form.formState.errors.title?.message}
      >
        <Input {...form.register("title")} />
      </FormField>
      <FormField id="reference" label="Reference" error={form.formState.errors.reference?.message}>
        <Input {...form.register("reference")} />
      </FormField>
      <FormError message={form.formState.errors.root?.server?.message} />
      <Button type="submit">Save example</Button>
    </form>
  );
}

describe("applyValidationErrors", () => {
  it("maps explicit contract keys, focuses in form order, and preserves domain errors", async () => {
    const user = userEvent.setup();
    render(<ValidationExample />);
    await user.click(screen.getByRole("button", { name: "Save example" }));
    const title = screen.getByRole("textbox", { name: "Title" });
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription("A short example title. Enter a title.");
    expect(screen.getByRole("textbox", { name: "Reference" })).toHaveAccessibleDescription(
      "Reference is already in use.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This example cannot be changed.");
  });
});

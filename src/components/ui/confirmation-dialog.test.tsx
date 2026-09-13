import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

function renderDialog(onConfirm: () => Promise<void> | void = vi.fn()) {
  return render(
    <ConfirmationDialog
      trigger={<Button>Remove example</Button>}
      title="Remove this example?"
      description="This removes the example from this demonstration only."
      confirmLabel="Remove example"
      destructive
      onConfirm={onConfirm}
    />,
  );
}

describe("ConfirmationDialog", () => {
  it("labels the dialog, starts at Cancel, contains keyboard focus and restores the trigger after Escape", async () => {
    const user = userEvent.setup();
    renderDialog();
    const trigger = screen.getByRole("button", { name: "Remove example" });
    await user.click(trigger);
    const dialog = screen.getByRole("alertdialog", { name: "Remove this example?" });
    expect(dialog).toHaveAccessibleDescription(
      "This removes the example from this demonstration only.",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Remove example" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("prevents duplicate confirmation and closing while an action is in flight", async () => {
    const user = userEvent.setup();
    let resolveAction: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );
    renderDialog(onConfirm);
    await user.click(screen.getByRole("button", { name: "Remove example" }));
    await user.dblClick(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove example" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Please wait…" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    resolveAction();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps failure beside the action and never displays thrown exception details", async () => {
    const user = userEvent.setup();
    renderDialog(() => Promise.reject(new Error("SQLSTATE secret /private/server/path")));
    await user.click(screen.getByRole("button", { name: "Remove example" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove example" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The action could not be completed. Try again.",
    );
    expect(screen.queryByText(/SQLSTATE/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove example" }),
    ).toBeEnabled();
  });
});

import { Button, type ButtonProps } from "@/components/ui/button";

export function IconButton({
  label,
  ...props
}: Omit<ButtonProps, "aria-label" | "size"> & { label: string }) {
  return <Button variant="ghost" {...props} size="icon" aria-label={label} />;
}

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Component review" };

export default async function DesignReviewRoute({
  params,
}: {
  params: Promise<{ pattern?: string[] }>;
}) {
  if (process.env.NODE_ENV === "development") {
    const { DesignReview } = await import("@/dev/design-review");
    const { pattern } = await params;
    const path = pattern?.join("/") ?? "overview";
    if (!["overview", "table", "detail", "form", "components", "login"].includes(path)) notFound();
    return <DesignReview pattern={path} />;
  }
  notFound();
}

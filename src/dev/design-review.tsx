import { AppShell, type ShellNavigationItem } from "@/components/layout/app-shell";
import { Overview } from "@/features/overview/components/overview";
import { TablePattern } from "./table-pattern";
import { DetailPattern } from "./detail-pattern";
import { FormPattern } from "./form-pattern";
import { ComponentsPattern } from "./components-pattern";
import { LoginPattern } from "./login-pattern";

const navigation: ShellNavigationItem[] = [
  { href: "/design-system", label: "Home", icon: "home" },
  { href: "/design-system/table", label: "Table pattern", icon: "table" },
  { href: "/design-system/detail", label: "Detail pattern", icon: "detail" },
  { href: "/design-system/form", label: "Form pattern", icon: "form" },
  { href: "/design-system/components", label: "Components & states", icon: "components" },
];

export function DesignReview({ pattern }: { pattern: string }) {
  if (pattern === "login") return <LoginPattern />;
  const pages: Record<string, { title: string; content: React.ReactNode }> = {
    overview: { title: "Home", content: <Overview review /> },
    table: { title: "Table pattern", content: <TablePattern /> },
    detail: { title: "Detail pattern", content: <DetailPattern /> },
    form: { title: "Form pattern", content: <FormPattern /> },
    components: { title: "Components & states", content: <ComponentsPattern /> },
  };
  const page = pages[pattern];
  return (
    <AppShell navigation={navigation} title={page.title} review>
      {page.content}
    </AppShell>
  );
}

import type { ReactNode } from "react";

export function DetailLayout({ children, sidebar }: { children: ReactNode; sidebar?: ReactNode }) {
  return (
    <div
      className={
        sidebar
          ? "grid min-w-0 items-start gap-5 [overflow-wrap:anywhere] lg:grid-cols-[minmax(0,1fr)_18rem]"
          : "min-w-0 [overflow-wrap:anywhere]"
      }
    >
      <div className="min-w-0 space-y-5">{children}</div>
      {sidebar && (
        <aside aria-label="Resource details" className="min-w-0 space-y-5">
          {sidebar}
        </aside>
      )}
    </div>
  );
}

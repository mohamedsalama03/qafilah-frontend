import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  status?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

export function PageHeader({
  title,
  description,
  primaryAction,
  secondaryActions,
  status,
  breadcrumbs,
}: PageHeaderProps) {
  return (
    <header className="mb-6 space-y-3">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
            {breadcrumbs.map((item, index) => (
              <li
                key={`${item.href ?? "current"}-${item.label}`}
                className="inline-flex items-center gap-1"
              >
                {index > 0 && <ChevronRight aria-hidden="true" className="size-3 rtl:rotate-180" />}
                {item.href ? (
                  <Link
                    href={item.href}
                    prefetch={false}
                    className="rounded px-1 py-1 hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="px-1">
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
            {status}
          </div>
          {description && (
            <p className="mt-1.5 max-w-prose text-sm leading-6 text-text-muted">{description}</p>
          )}
        </div>
        {(primaryAction || secondaryActions) && (
          <div className="flex flex-wrap items-center gap-2">
            {secondaryActions}
            {primaryAction}
          </div>
        )}
      </div>
    </header>
  );
}

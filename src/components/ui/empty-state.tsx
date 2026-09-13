import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      {icon && (
        <div className="mb-4 text-text-muted" aria-hidden="true">
          {icon}
        </div>
      )}
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

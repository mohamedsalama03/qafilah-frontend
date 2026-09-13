export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Loading workspace" className="mx-auto max-w-lg px-6 pt-32">
      <span className="sr-only" role="status">
        Loading workspace
      </span>
      <div className="h-7 w-48 rounded-sm bg-surface-subtle" />
      <div className="mt-4 h-4 w-full rounded-sm bg-surface-subtle" />
      <div className="mt-2 h-4 w-3/4 rounded-sm bg-surface-subtle" />
      <div className="mt-8 h-28 rounded-md border border-border bg-surface" />
    </main>
  );
}

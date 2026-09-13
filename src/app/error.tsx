"use client";

export default function RouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main role="alert" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">This page couldn’t load</h1>
      <p className="mt-2 text-text-muted">
        Try opening it again. If the problem continues, contact your administrator.
      </p>
      <button
        onClick={reset}
        className="mt-6 self-start rounded-sm bg-brand px-4 py-2.5 font-medium text-white"
      >
        Try again
      </button>
    </main>
  );
}

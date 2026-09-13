"use client";

import "./globals.css";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main role="alert" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
          <h1 className="text-2xl font-semibold">Qafilah couldn’t open</h1>
          <p className="mt-2 text-text-muted">
            Please try again. Your store service remains the source of truth for any operation.
          </p>
          <button
            onClick={reset}
            className="mt-6 self-start rounded-sm bg-brand px-4 py-2.5 text-white"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

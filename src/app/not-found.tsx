import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Brand } from "@/components/layout/brand";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
      <Brand />
      <FileQuestion size={30} className="mt-12 text-text-muted" aria-hidden="true" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 leading-6 text-text-muted">
        This page may have moved, or the address may be incorrect.
      </p>
      <Link
        href="/"
        className="mt-6 self-start rounded-sm bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
      >
        Return to workspace
      </Link>
    </main>
  );
}

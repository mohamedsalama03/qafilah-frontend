"use client";

import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/field";

export function LoginPattern() {
  return (
    <main className="flex min-h-dvh flex-col px-5">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 py-7">
        <Brand />
        <Link href="/design-system/components" className="text-sm text-brand underline">
          Return to component review
        </Link>
      </header>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pb-24">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h1>
        <p className="mt-2 text-sm text-text-muted">Manage your store with Qafilah.</p>
        <p className="mt-6 rounded-sm border border-border bg-surface-subtle px-3 py-2.5 text-xs leading-5 text-text-muted">
          Development-only login layout. Sign-in is disabled; do not enter real credentials.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
          }}
          className="mt-6 space-y-5"
        >
          <fieldset disabled className="space-y-5">
            <FormField id="login-email" label="Email address">
              <Input type="email" autoComplete="off" placeholder="Email address" />
            </FormField>
            <FormField id="login-password" label="Password">
              <Input type="password" autoComplete="off" placeholder="Password" />
            </FormField>
            <Button variant="primary" className="w-full">
              Sign in
            </Button>
          </fieldset>
        </form>
        <p className="mt-5 text-xs leading-5 text-text-muted">
          Access is securely managed by your store service.
        </p>
      </div>
      <footer className="pb-6 text-center text-xs text-text-muted">
        Qafilah Merchant Dashboard
      </footer>
    </main>
  );
}

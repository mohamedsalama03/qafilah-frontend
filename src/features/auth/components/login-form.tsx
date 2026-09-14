"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";
import { FormError, FormField, Input } from "@/components/ui/field";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import { applyValidationErrors } from "@/lib/forms/apply-validation-errors";
import { ConnectionUnavailable } from "./connection-unavailable";
import { useMerchantApi } from "./merchant-api-provider";
import { loginDestination } from "./login-destination";

type Credentials = { email: string; password: string };

export function LoginForm({ returnTo, expired = false }: { returnTo?: string; expired?: boolean }) {
  const api = useMerchantApi();
  const router = useRouter();
  const destination = loginDestination(returnTo);
  const [checking, setChecking] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const request = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const form = useForm<Credentials>({ defaultValues: { email: "", password: "" } });

  useEffect(() => {
    if (!api) return;
    let active = true;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!active) return;
      void api.authAdapter
        .loadIdentity(controller.signal)
        .then((identity) => {
          if (!active) return;
          if (identity) router.replace(destination);
          else setChecking(false);
        })
        .catch((error: unknown) => {
          if (!active) return;
          const normalized = normalizeUnexpectedError(error);
          if (!["unauthenticated", "session-expired", "cancelled"].includes(normalized.kind))
            setFailure(normalized);
          setChecking(false);
        });
    });
    return () => {
      active = false;
      controller.abort();
      request.current?.abort();
    };
  }, [api, router, destination]);

  if (!api) return <ConnectionUnavailable />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Guard before RHF validation, so a second submission cannot reset the first pending state.
    if (submitting.current) return;
    submitting.current = true;
    try {
      await form.handleSubmit(async (values) => {
        const controller = new AbortController();
        request.current = controller;
        setFailure(null);
        form.clearErrors();
        try {
          await api.login(values, controller.signal);
          if (controller.signal.aborted) return;
          form.reset({ email: "", password: "" });
          router.replace(destination);
        } catch (error) {
          if (controller.signal.aborted) return;
          const normalized = normalizeUnexpectedError(error);
          setFailure(normalized);
          form.resetField("password");
          applyValidationErrors(
            form,
            normalized.fieldErrors,
            { email: "email", password: "password" },
            normalized.formErrors.join(" ") || undefined,
          );
        } finally {
          request.current = null;
        }
      })(event);
    } finally {
      submitting.current = false;
    }
  };

  const message =
    failure?.kind === "rate-limited" && failure.retryAfterSeconds
      ? `Too many sign-in attempts. Try again in ${failure.retryAfterSeconds} seconds.`
      : failure?.kind === "unauthenticated"
        ? "Sign-in could not be confirmed. Refresh and try again."
        : failure?.kind === "forbidden"
          ? "This account cannot access the workspace. Contact your administrator."
          : failure?.message;

  return (
    <main className="flex min-h-dvh flex-col px-5">
      <header className="mx-auto w-full max-w-6xl py-7">
        <Brand />
      </header>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pb-24">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h1>
        <p className="mt-2 text-sm text-text-muted">Manage your store with Qafilah.</p>
        {checking ? (
          <p role="status" className="mt-6 text-sm text-text-muted">
            Checking your session…
          </p>
        ) : (
          <>
            {expired && (
              <p role="status" className="mt-6 text-sm text-text-muted">
                Your session has expired. Sign in again to continue.
              </p>
            )}
            <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
              <FormError message={form.formState.errors.root?.server?.message ?? message} />
              {failure?.requestId && (
                <p className="break-all text-xs text-text-muted">
                  Reference ID: {failure.requestId}
                </p>
              )}
              <FormField
                id="merchant-email"
                label="Email address"
                error={form.formState.errors.email?.message}
                required
              >
                <Input
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={form.formState.isSubmitting}
                  {...form.register("email", {
                    required: "Enter your email address.",
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: "Enter a valid email address.",
                    },
                  })}
                />
              </FormField>
              <div className="space-y-2">
                <FormField
                  id="merchant-password"
                  label="Password"
                  error={form.formState.errors.password?.message}
                  required
                >
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    disabled={form.formState.isSubmitting}
                    {...form.register("password", { required: "Enter your password." })}
                  />
                </FormField>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-controls="merchant-password"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "Hide password" : "Show password"}
                </Button>
              </div>
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                pending={form.formState.isSubmitting}
                pendingLabel="Signing in…"
              >
                Sign in
              </Button>
            </form>
          </>
        )}
      </div>
      <footer className="pb-6 text-center text-xs text-text-muted">
        Qafilah Merchant Dashboard
      </footer>
    </main>
  );
}

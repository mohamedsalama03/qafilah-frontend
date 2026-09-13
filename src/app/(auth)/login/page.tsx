import type { Metadata } from "next";
import { ConnectionUnavailable } from "@/features/auth/components/connection-unavailable";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <ConnectionUnavailable />;
}

import type { Metadata } from "next";
import { MerchantApiProvider } from "@/features/auth/components/merchant-api-provider";
import "./globals.css";

// Every document, including 404s, needs a fresh CSP nonce and private cache semantics.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Qafilah — Merchant dashboard", template: "%s — Qafilah" },
  description: "Qafilah merchant workspace",
  robots: { index: false, follow: false, noarchive: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <MerchantApiProvider>{children}</MerchantApiProvider>
      </body>
    </html>
  );
}

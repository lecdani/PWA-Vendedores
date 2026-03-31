import type { Metadata } from "next";
import { LanguageProvider } from "@/shared/i18n/language-provider";
import { AuthProvider } from "@/shared/auth/auth-provider";
import { OfflineBootstrap } from "@/shared/offline/offline-bootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "PWA Vendedores",
  description: "Portal de Vendedores - Eternal Cosmetics",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <LanguageProvider>
          <AuthProvider>
            <OfflineBootstrap />
            {children}
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

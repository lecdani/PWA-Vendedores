import type { Metadata } from "next";
import { LanguageProvider } from "@/shared/i18n/language-provider";
import { AuthProvider } from "@/shared/auth/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "PWA Vendedores",
  description: "Portal de Vendedores - Eternal Cosmetics",
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
          <AuthProvider>{children}</AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

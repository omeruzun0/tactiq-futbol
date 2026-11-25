import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TactIQ Futbol | Kapsamlı Maç Analiz & Tahmin Motoru",
  description:
    "Dixon-Coles Poisson gol modeli, 6 boyutlu taktiksel oyun tarzı eşleşmesi, xG ve form analizi ile profesyonel futbol tahmin uygulaması.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-screen antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}

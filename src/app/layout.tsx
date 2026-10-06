import "./globals.css";
import type { ReactNode } from "react";
import RootHeader from "@/components/RootHeader";
import SkipToContent from "@/components/SkipToContent";
import Footer from "@/components/Footer";
import PreloadAsFix from "@/components/PreloadAsFix";
import ThemeScript from "@/components/ThemeScript";
import FirebaseConfigScript from "@/components/FirebaseConfigScript";
import NetworkBanner from "@/components/NetworkBanner";
import AppToaster from "@/components/AppToaster";

export const metadata = {
  title: "PCM • Terceiros",
  description: "Acompanhamento de serviços de terceiros (PCM)",
};


export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <FirebaseConfigScript />
      </head>
      <body className="relative flex min-h-dvh flex-col bg-background text-foreground">
        <PreloadAsFix />
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-transparent dark:from-primary/15 sm:hidden" />
          <div className="absolute left-[-20%] top-[-25%] hidden h-64 w-64 rounded-full bg-primary/20 blur-[120px] dark:bg-primary/25 sm:block lg:h-72 lg:w-72" />
          <div className="absolute right-[-25%] top-[-12%] hidden h-72 w-72 rounded-full bg-emerald-200/35 blur-[140px] dark:bg-slate-900/60 sm:block lg:h-80 lg:w-80" />
          <div className="absolute inset-x-0 bottom-[-35%] h-[260px] bg-gradient-to-t from-primary/10 via-transparent to-transparent dark:from-primary/20 sm:h-[320px]" />
        </div>
        <SkipToContent />
        <RootHeader />
        <main
          id="conteudo"
          className="relative flex-1 pb-14 pt-6 sm:pb-16 sm:pt-10 lg:pb-20"
        >
          <div className="relative z-10 px-4 sm:px-6 lg:px-8">{children}</div>
        </main>
        <Footer />
        <AppToaster />
        <NetworkBanner />
      </body>
    </html>
  );
}

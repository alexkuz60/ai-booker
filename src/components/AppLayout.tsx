import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { usePageHeader } from "@/hooks/usePageHeader";

export function AppLayout({ children }: { children: ReactNode }) {
  const { title, subtitle, headerRight } = usePageHeader();
  const isHome = useLocation().pathname === "/";

  return (
    <SidebarProvider defaultOpen={false}>
      <div className="h-screen flex w-full overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {!isHome && (
            <header className="h-12 flex items-center bg-background/80 backdrop-blur-sm border-b border-border sticky top-0 z-10 px-3 gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground shrink-0" />
              {title && (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <h1 className="font-display text-lg font-bold text-foreground whitespace-nowrap">{title}</h1>
                  {subtitle && (
                    <>
                      <span className="text-muted-foreground/50 text-xs">·</span>
                      <span className="text-sm text-muted-foreground font-body truncate">{subtitle}</span>
                    </>
                  )}
                </div>
              )}
              {headerRight && <div className="shrink-0 ml-auto">{headerRight}</div>}
            </header>
          )}
          <main className="flex-1 min-h-0 overflow-auto relative">
            {isHome && (
              <div className="absolute top-3 left-3 z-10">
                <SidebarTrigger className="text-foreground/70 hover:text-foreground shrink-0 drop-shadow-md" />
              </div>
            )}
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

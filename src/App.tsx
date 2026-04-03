import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { LanguageProvider } from "@/hooks/useLanguage";
import { AppLayout } from "@/components/AppLayout";
import { PageHeaderProvider } from "@/hooks/usePageHeader";
import { ProjectStorageProvider } from "@/hooks/useProjectStorageContext";
import { usePipelineGating } from "@/hooks/usePipelineGating";
import { useLanguage } from "@/hooks/useLanguage";
import { toast } from "sonner";
import { lazy, Suspense, useEffect, useRef } from "react";

// Critical path — loaded synchronously
import Home from "./pages/Home";
import Library from "./pages/Library";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// Heavy pages — lazy loaded
const Parser = lazy(() => import("./pages/Parser"));
const Studio = lazy(() => import("./pages/Studio"));
const Montage = lazy(() => import("./pages/Montage"));
const Narrators = lazy(() => import("./pages/Narrators"));
const Soundscape = lazy(() => import("./pages/Soundscape"));
const Translation = lazy(() => import("./pages/Translation"));
const Profile = lazy(() => import("./pages/Profile"));
const Admin = lazy(() => import("./pages/Admin"));

const queryClient = new QueryClient();

/** Route guard component — redirects locked routes to Library */
function GatedRoute({ route, children }: { route: string; children: React.ReactNode }) {
  const { isLocked, lockReason, loading } = usePipelineGating();
  const { isRu } = useLanguage();
  const toastShown = useRef(false);

  if (loading) return null;

  if (isLocked(route)) {
    if (!toastShown.current) {
      toastShown.current = true;
      const reason = lockReason(route, isRu);
      if (reason) {
        // Defer toast to avoid render-phase side effects
        setTimeout(() => toast.warning(reason), 0);
      }
    }
    return <Navigate to="/library" replace />;
  }

  return <>{children}</>;
}

const LazyFallback = () => (
  <div className="min-h-[50vh] flex items-center justify-center">
    <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
  </div>
);

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  return (
    <PageHeaderProvider>
      <ProjectStorageProvider>
        <AppLayout>
          <Suspense fallback={<LazyFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/library" element={<Library />} />
              <Route path="/parser" element={<Parser />} />
              <Route path="/studio" element={
                <GatedRoute route="/studio"><Studio /></GatedRoute>
              } />
              <Route path="/montage" element={
                <GatedRoute route="/montage"><Montage /></GatedRoute>
              } />
              <Route path="/narrators" element={<Narrators />} />
              <Route path="/soundscape" element={<Soundscape />} />
              <Route path="/translation" element={
                <GatedRoute route="/translation"><Translation /></GatedRoute>
              } />
              <Route path="/profile" element={<Profile />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AppLayout>
      </ProjectStorageProvider>
    </PageHeaderProvider>
  );
}

function AuthRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/library" replace />;
  return <Auth />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/auth" element={<AuthRoute />} />
                <Route path="/*" element={<ProtectedRoutes />} />
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </LanguageProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

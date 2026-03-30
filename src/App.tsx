import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { LanguageProvider } from "@/hooks/useLanguage";
import { AppLayout } from "@/components/AppLayout";
import { PageHeaderProvider } from "@/hooks/usePageHeader";
import { ProjectStorageProvider } from "@/hooks/useProjectStorageContext";
import Library from "./pages/Library";
import Parser from "./pages/Parser";
import Studio from "./pages/Studio";
import Montage from "./pages/Montage";
import Narrators from "./pages/Narrators";
import Soundscape from "./pages/Soundscape";
import Translation from "./pages/Translation";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

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
          <Routes>
            <Route path="/" element={<Library />} />
            <Route path="/parser" element={<Parser />} />
            <Route path="/studio" element={<Studio />} />
            <Route path="/montage" element={<Montage />} />
            <Route path="/narrators" element={<Narrators />} />
            <Route path="/soundscape" element={<Soundscape />} />
            <Route path="/translation" element={<Translation />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </ProjectStorageProvider>
    </PageHeaderProvider>
  );
}

function AuthRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
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

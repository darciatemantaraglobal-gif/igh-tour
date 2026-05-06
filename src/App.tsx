import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { OfflineBar } from "@/components/OfflineBar";
import { Loader2 } from "lucide-react";

import Index from "./pages/Index.tsx";
import Login from "./pages/Login";
import Auth from "./pages/Auth";
import PublicCheck from "./pages/PublicCheck";
import NotFound from "./pages/NotFound.tsx";

const Calculator    = lazy(() => import("./pages/Calculator"));
const Packages      = lazy(() => import("./pages/Packages"));
const PackageDetail = lazy(() => import("./pages/PackageDetail"));
const ProgressTracker = lazy(() => import("./pages/ProgressTracker"));
const TripDetail    = lazy(() => import("./pages/TripDetail"));
const JamaahProfile = lazy(() => import("./pages/JamaahProfile"));
const Settings      = lazy(() => import("./pages/Settings"));
const Notes         = lazy(() => import("./pages/Notes"));
const ExportCenter  = lazy(() => import("./pages/ExportCenter"));

function PageSpinner() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Memuat halaman…</p>
    </div>
  );
}
import { useRatesStore } from "@/store/ratesStore";
import { usePackagesStore } from "@/store/packagesStore";
import { useTripsStore } from "@/store/tripsStore";
import { useAuthStore } from "@/store/authStore";
import { useRegionalStore } from "@/store/regionalStore";
import { applyAppearanceSettings, loadAppearanceSettings } from "@/lib/appearance";
import { isSupabaseConfigured } from "@/lib/supabase";
import { startRealtimeSync } from "@/lib/supabaseRealtime";
import { initSyncStatusListeners } from "@/store/syncStatusStore";
import { toast } from "sonner";

const queryClient = new QueryClient();

function StoreBootstrap() {
  const refreshRates = useRatesStore((s) => s.refresh);
  const refreshPackages = usePackagesStore((s) => s.refresh);
  const fetchTrips = useTripsStore((s) => s.fetchTrips);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    refreshRates();
    if (!isAuthenticated) return;
    void Promise.all([refreshPackages(), fetchTrips()]);
  }, [refreshRates, refreshPackages, fetchTrips, isAuthenticated]);

  // Realtime sync — subscribe perubahan dari device lain
  useEffect(() => {
    if (!isAuthenticated || !isSupabaseConfigured()) return;
    const unsubscribe = startRealtimeSync();
    return unsubscribe;
  }, [isAuthenticated]);

  return null;
}

function LoginAlertNotifier() {
  const newLoginAt = useAuthStore((s) => s.newLoginAt);
  const clearNewLogin = useAuthStore((s) => s.clearNewLogin);
  useEffect(() => {
    if (newLoginAt) {
      const formatted = new Intl.DateTimeFormat("id-ID", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
        timeZone: "Asia/Jakarta",
      }).format(new Date(newLoginAt));
      toast.warning("Login baru terdeteksi", {
        description: `Sesi login sebelumnya: ${formatted}`,
        duration: 6000,
      });
      clearNewLogin();
    }
  }, [newLoginAt, clearNewLogin]);
  return null;
}

function AppearanceBootstrap() {
  useEffect(() => {
    const applySavedAppearance = () => applyAppearanceSettings(loadAppearanceSettings());
    applySavedAppearance();
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applySavedAppearance);
    window.addEventListener("storage", applySavedAppearance);
    return () => {
      mediaQuery.removeEventListener("change", applySavedAppearance);
      window.removeEventListener("storage", applySavedAppearance);
    };
  }, []);
  return null;
}

function LangDirectionBootstrap() {
  const language = useRegionalStore((s) => s.language);
  useEffect(() => {
    const isAr = language === "ar";
    document.documentElement.dir = isAr ? "rtl" : "ltr";
    document.documentElement.lang = language === "ar" ? "ar" : language === "en" ? "en" : "id";
  }, [language]);
  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const needsBootstrap = useAuthStore((s) => s.needsBootstrap);
  const location = useLocation();
  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white/60 text-sm">
        Memuat sesi…
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (needsBootstrap) {
    return <Navigate to="/bootstrap" replace />;
  }
  return <>{children}</>;
}

function AuthInitBootstrap() {
  const init = useAuthStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  return null;
}

function SyncStatusBootstrap() {
  useEffect(() => initSyncStatusListeners(), []);
  return null;
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes location={location}>
        <Route path="/login" element={<Login />} />
        <Route path="/bootstrap" element={<Auth />} />
        <Route path="/cek" element={<PublicCheck />} />
        <Route path="/cek/:code" element={<PublicCheck />} />

        <Route path="/" element={<RequireAuth><Index /></RequireAuth>} />
        <Route path="/calculator" element={<RequireAuth><DashboardLayout><Calculator /></DashboardLayout></RequireAuth>} />
        <Route path="/packages" element={<RequireAuth><DashboardLayout><Packages /></DashboardLayout></RequireAuth>} />
        <Route path="/packages/:id" element={<RequireAuth><DashboardLayout><PackageDetail /></DashboardLayout></RequireAuth>} />
        <Route path="/progress" element={<RequireAuth><DashboardLayout><ProgressTracker /></DashboardLayout></RequireAuth>} />
        <Route path="/trips/:id" element={<RequireAuth><DashboardLayout><TripDetail /></DashboardLayout></RequireAuth>} />
        <Route path="/trips/:id/jamaah/:jamaahId" element={<RequireAuth><DashboardLayout><JamaahProfile /></DashboardLayout></RequireAuth>} />
        {/* Alias /paket — terminologi UI sesuai sidebar "Paket Trip" */}
        <Route path="/paket/:id" element={<RequireAuth><DashboardLayout><TripDetail /></DashboardLayout></RequireAuth>} />
        <Route path="/paket/:id/jamaah/:jamaahId" element={<RequireAuth><DashboardLayout><JamaahProfile /></DashboardLayout></RequireAuth>} />
        <Route path="/notes" element={<RequireAuth><DashboardLayout><Notes /></DashboardLayout></RequireAuth>} />
        <Route path="/exports" element={<RequireAuth><DashboardLayout><ExportCenter /></DashboardLayout></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><DashboardLayout><Settings /></DashboardLayout></RequireAuth>} />
        <Route path="/auth" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppearanceBootstrap />
      <LangDirectionBootstrap />
      <AuthInitBootstrap />
      <SyncStatusBootstrap />
      <StoreBootstrap />
      <LoginAlertNotifier />
      <OfflineBar />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AnimatedRoutes />
        <PwaInstallPrompt />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

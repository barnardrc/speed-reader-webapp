import { useCallback, useEffect, useMemo, useState } from "react";

import { getCurrentUser } from "./lib/api";
import type { AuthResponse } from "./lib/types";
import { AccountPage } from "./features/account/AccountPage";
import { AppEntryPage } from "./features/app/AppEntryPage";
import { AuthPage } from "./features/auth/AuthPage";
import { LandingPage } from "./features/landing/LandingPage";
import { AiSetupOnboardingPage } from "./features/onboarding/AiSetupOnboardingPage";
import { useAuthStore } from "./state/authStore";

const ONBOARDING_KEY = "speed_reader_web_onboarding_complete";

type RoutePath = "/" | "/app" | "/account" | "/onboarding/ai" | "/login" | "/signup";

const AUTH_EXPIRY_SKEW_MS = 5_000;

function normalizePath(pathname: string): RoutePath {
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    return "/app";
  }
  if (pathname === "/account" || pathname.startsWith("/account/")) {
    return "/account";
  }
  if (pathname === "/onboarding/ai" || pathname.startsWith("/onboarding/ai/")) {
    return "/onboarding/ai";
  }
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return "/login";
  }
  if (pathname === "/signup" || pathname.startsWith("/signup/")) {
    return "/signup";
  }
  return "/";
}

function hasGuestMode(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get("mode") === "guest";
}

function decodeJwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const payloadPart = parts[1];
  const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    const decoded = window.atob(`${normalized}${padding}`);
    const payload = JSON.parse(decoded) as Record<string, unknown>;
    const exp = payload.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) {
      return null;
    }
    return exp * 1000;
  } catch {
    return null;
  }
}

function isTokenStale(token: string): boolean {
  const expiryMs = decodeJwtExpiryMs(token);
  if (expiryMs === null) {
    return true;
  }
  return Date.now() >= expiryMs - AUTH_EXPIRY_SKEW_MS;
}

export default function App() {
  const [locationState, setLocationState] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  const [showOnboarding, setShowOnboarding] = useState(false);

  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const hydrated = useAuthStore((state) => state.hydrated);
  const setSession = useAuthStore((state) => state.setSession);
  const clearSession = useAuthStore((state) => state.clearSession);
  const setHydrated = useAuthStore((state) => state.setHydrated);

  useEffect(() => {
    function onPopState(): void {
      setLocationState({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    }

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (hydrated) {
      return;
    }

    if (!token) {
      setHydrated(true);
      return;
    }

    if (isTokenStale(token)) {
      clearSession();
      setHydrated(true);
      return;
    }

    let cancelled = false;
    void getCurrentUser()
      .then((profile) => {
        if (!cancelled) {
          setSession(token, profile);
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearSession();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, hydrated, setHydrated, setSession, clearSession]);

  const routePath = useMemo(() => normalizePath(locationState.pathname), [locationState.pathname]);
  const isAuthenticated = Boolean(token && user);
  const guestMode = useMemo(() => routePath === "/app" && !isAuthenticated && hasGuestMode(locationState.search), [routePath, isAuthenticated, locationState.search]);

  useEffect(() => {
    if (routePath !== "/app") {
      setShowOnboarding(false);
      return;
    }

    const complete = window.localStorage.getItem(ONBOARDING_KEY) === "1";
    setShowOnboarding(!complete);
  }, [routePath]);

  const navigate = useCallback((pathWithOptionalQuery: string): void => {
    const destination = new URL(pathWithOptionalQuery, window.location.origin);
    const nextPath = destination.pathname;
    const nextSearch = destination.search;

    if (window.location.pathname === nextPath && window.location.search === nextSearch) {
      return;
    }

    window.history.pushState({}, "", `${nextPath}${nextSearch}`);
    setLocationState({
      pathname: nextPath,
      search: nextSearch,
    });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  function closeOnboarding(): void {
    window.localStorage.setItem(ONBOARDING_KEY, "1");
    setShowOnboarding(false);
  }

  function onAuthSuccess(auth: AuthResponse): void {
    setSession(auth.access_token, auth.user);
    navigate("/app");
  }

  if (!hydrated) {
    return <main className="app-boot">Loading...</main>;
  }

  if (routePath === "/app") {
    return (
      <AppEntryPage
        guestMode={guestMode || !isAuthenticated}
        showOnboarding={showOnboarding}
        onCloseOnboarding={closeOnboarding}
        onLogIn={() => navigate("/login")}
        onSignUp={() => navigate("/signup")}
        user={user}
        onOpenAccountPage={() => navigate("/account")}
        onLogout={() => {
          clearSession();
          navigate("/");
        }}
      />
    );
  }

  if (routePath === "/account") {
    if (!isAuthenticated || !user) {
      return (
        <AuthPage
          mode="login"
          onBackToLanding={() => navigate("/")}
          onContinueToApp={() => navigate("/app?mode=guest")}
          onSwitchMode={() => navigate("/signup")}
          onAuthSuccess={(auth) => {
            setSession(auth.access_token, auth.user);
            navigate("/account");
          }}
        />
      );
    }

    return (
      <AccountPage
        user={user}
        onBackToReader={() => navigate("/app")}
        onLogout={() => {
          clearSession();
          navigate("/");
        }}
        onAccountDeleted={() => {
          clearSession();
          navigate("/");
        }}
      />
    );
  }

  if (routePath === "/onboarding/ai") {
    if (!isAuthenticated || !user) {
      return (
        <AuthPage
          mode="login"
          onBackToLanding={() => navigate("/")}
          onContinueToApp={() => navigate("/app?mode=guest")}
          onSwitchMode={() => navigate("/signup")}
          onAuthSuccess={(auth) => {
            setSession(auth.access_token, auth.user);
            navigate("/onboarding/ai");
          }}
        />
      );
    }

    return (
      <AiSetupOnboardingPage
        user={user}
        onSkip={() => navigate("/app")}
        onOpenAccountSetup={() => navigate("/account")}
      />
    );
  }

  if (routePath === "/login") {
    return (
      <AuthPage
        mode="login"
        onBackToLanding={() => navigate("/")}
        onContinueToApp={() => navigate("/app?mode=guest")}
        onSwitchMode={() => navigate("/signup")}
        onAuthSuccess={onAuthSuccess}
      />
    );
  }

  if (routePath === "/signup") {
    return (
      <AuthPage
        mode="signup"
        onBackToLanding={() => navigate("/")}
        onContinueToApp={() => navigate("/app?mode=guest")}
        onSwitchMode={() => navigate("/login")}
        onAuthSuccess={(auth) => {
          setSession(auth.access_token, auth.user);
          navigate("/onboarding/ai");
        }}
      />
    );
  }

  return <LandingPage onContinueToApp={() => navigate("/app?mode=guest")} onLogIn={() => navigate("/login")} onSignUp={() => navigate("/signup")} />;
}

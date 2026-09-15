import { create } from "zustand";

import type { UserProfile } from "../lib/types";

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  hydrated: boolean;
  setSession: (token: string, user: UserProfile) => void;
  clearSession: () => void;
  setHydrated: (value: boolean) => void;
}

const TOKEN_KEY = "speed_reader_auth_token";
const USER_KEY = "speed_reader_auth_user";

function readStoredUser(): UserProfile | null {
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: window.localStorage.getItem(TOKEN_KEY),
  user: readStoredUser(),
  hydrated: false,
  setSession: (token, user) => {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },
  clearSession: () => {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
  },
  setHydrated: (hydrated) => set({ hydrated }),
}));

export const AUTH_STORAGE_KEYS = {
  token: TOKEN_KEY,
  user: USER_KEY,
} as const;

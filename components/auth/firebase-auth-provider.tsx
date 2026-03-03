"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";

interface AuthUser {
  uid: string;
  email: string;
}

interface FirebaseAuthContextValue {
  configured: boolean;
  loading: boolean;
  user: AuthUser | null;
  signInWithOtp: (input: { email: string; otp: string }) => Promise<void>;
  signOutCurrentUser: () => Promise<void>;
}

const FirebaseAuthContext = createContext<FirebaseAuthContextValue | null>(null);

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidOtp(value: string) {
  return /^\d{6}$/.test(value.trim());
}

interface SessionPayload {
  ok?: boolean;
  message?: string;
  user?: AuthUser;
}

export function FirebaseAuthProvider({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let mounted = true;

    async function bootstrapSession() {
      try {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          cache: "no-store"
        });

        const payload = (await response.json().catch(() => null)) as SessionPayload | null;
        if (!mounted) {
          return;
        }

        if (response.ok && payload?.ok && payload.user) {
          setUser({
            uid: payload.user.uid,
            email: payload.user.email
          });
        } else {
          setUser(null);
        }
      } catch {
        if (mounted) {
          setUser(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void bootstrapSession();
    return () => {
      mounted = false;
    };
  }, []);

  const signInWithOtp = useCallback(async (input: { email: string; otp: string }) => {
    const email = normalizeEmail(input.email);
    const otp = input.otp.trim();

    if (!isValidEmail(email)) {
      throw new Error("Enter a valid email address.");
    }
    if (!isValidOtp(otp)) {
      throw new Error("OTP must be exactly 6 digits.");
    }

    const response = await fetch("/api/auth/session/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, otp })
    });

    const payload = (await response.json().catch(() => null)) as SessionPayload | null;
    if (!response.ok || !payload?.ok || !payload.user) {
      throw new Error(payload?.message ?? "Unable to sign in.");
    }

    setUser({
      uid: payload.user.uid,
      email: payload.user.email
    });
  }, []);

  const signOutCurrentUser = useCallback(async () => {
    try {
      await fetch("/api/auth/session/logout", {
        method: "POST",
        cache: "no-store"
      });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<FirebaseAuthContextValue>(
    () => ({
      configured: true,
      loading,
      user,
      signInWithOtp,
      signOutCurrentUser
    }),
    [loading, signInWithOtp, signOutCurrentUser, user]
  );

  return <FirebaseAuthContext.Provider value={value}>{children}</FirebaseAuthContext.Provider>;
}

export function useFirebaseAuth() {
  const context = useContext(FirebaseAuthContext);
  if (!context) {
    throw new Error("useFirebaseAuth must be used inside FirebaseAuthProvider.");
  }
  return context;
}


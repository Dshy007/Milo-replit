import { createContext, useContext, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";

type User = {
  id: string;
  username: string;
  email: string;
  tenantId: string;
};

type AuthContextType = {
  user: User | null;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  signup: (username: string, email: string, password: string, companyName: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        // Auto-login as freedom user for development
        await autoLogin();
      }
    } catch (error) {
      // Auto-login as freedom user for development
      await autoLogin();
    } finally {
      setIsLoading(false);
    }
  }

  async function autoLogin() {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          username: "freedom", 
          password: "password123", 
          rememberMe: true 
        }),
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
    }
  }

  async function login(username: string, password: string, rememberMe: boolean = false) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, rememberMe }),
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Login failed");
    }

    const data = await response.json();
    setUser(data.user);
    setLocation("/dashboard");
  }

  async function signup(username: string, email: string, password: string, companyName: string) {
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, companyName }),
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Signup failed");
    }

    const data = await response.json();
    setUser(data.user);
    setLocation("/dashboard");
  }

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
    queryClient.clear();
    setLocation("/login");
  }

  return (
    <AuthContext.Provider value={{ user, login, signup, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  // For testing: bypass login check entirely - auto-login handles authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Auto-login should have populated user - just render children
  return <>{children}</>;
}

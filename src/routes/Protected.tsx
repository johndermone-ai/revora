import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/ui';

// Blocks unauthenticated access to /app and /onboarding.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

// Blocks the app until the user has a business (onboarding gate).
export function RequireBusiness({ children }: { children: ReactNode }) {
  const { loading, businesses } = useAuth();
  if (loading) return <Spinner label="Loading…" />;
  if (!businesses || businesses.length === 0) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

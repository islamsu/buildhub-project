import { useEffect } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLocation } from 'wouter';
import { getRolePlatformPath } from '@/lib/rolePlatform';

// Legacy route (Phase 4A.6.4). The real, reachable vendor/provider dashboard
// is /platform/:role (RolePlatform.tsx) - it's where AuthPage.tsx already
// sends every provider on sign-in, and where Vendor Profile/Reputation/
// Analytics now actually live. This page exists only so that an old /provider
// bookmark or link still lands somewhere useful, by forwarding to the correct
// destination. It intentionally renders no content of its own: it previously
// duplicated Vendor Profile/Reputation/Analytics here (Phase 4A.6.1-4A.6.3)
// behind this exact redirect, which meant no real authenticated user could
// ever see them - see BUILDHUB_PHASE4A64_DASHBOARD_INTEGRATION.md.
export default function ProviderDashboard() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const userRole = (user as any)?.userRole ?? 'contractor';

  useEffect(() => {
    if (loading) return;
    if (isAuthenticated) navigate(getRolePlatformPath(userRole));
  }, [loading, isAuthenticated, userRole, navigate]);

  if (loading) return null;
  if (!isAuthenticated) { window.location.href = '/auth?mode=login'; return null; }
  return null;
}

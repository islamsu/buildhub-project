import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { Button } from '@/components/ui/button';
import LanguageToggle from '@/components/LanguageToggle';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Link, useLocation } from 'wouter';
import { Building2, Menu, X, Bell, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { getRolePlatformPath } from '@/lib/rolePlatform';

export default function Navbar() {
  const { lang, t, dir } = useLanguage();
  const { user, isAuthenticated, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location, navigate] = useLocation();

  const { data: notifData } = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  /**
   * THE PLAN BESIDE THE NAME, READ FROM THE BILLING SYSTEM.
   *
   * Never hard-coded and never derived from the role: this is
   * `billing.mySubscription`, the same server-resolved state the Plan & Billing
   * screen renders, so a trial that lapses or a subscription that goes past due
   * changes this label without anyone editing it here.
   *
   * `plan` is the EFFECTIVE plan - what the account may actually use today,
   * after expiry and grace periods are applied - which is the only version
   * worth showing next to somebody's name.
   */
  const { data: subscription } = trpc.billing.mySubscription.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  // Absent while loading, and absent if the query fails. A missing plan renders
  // NOTHING rather than a guess: "Free" shown to a Premium vendor because a
  // request was in flight is worse than no badge at all.
  const planLabel = subscription?.plan ? t(`billing.plan.${subscription.plan}`) : null;

  const isTransparent = location === '/';

  const getDashboardPath = () => getRolePlatformPath((user as any)?.userRole);

  /**
   * PRIMARY NAVIGATION, NOT ACCOUNT NAVIGATION.
   *
   * Dashboard and AI used to exist ONLY inside the avatar dropdown - the two
   * destinations a signed-in person uses most often, reachable only by opening
   * a menu that otherwise holds sign-out. The dropdown is for account
   * functions; where you WORK belongs in the bar.
   */
  const navLinks = [
    { label: t('nav.home'), href: '/' },
    ...(isAuthenticated
      ? [
          { label: t('nav.dashboard'), href: getDashboardPath() },
          { label: t('dash.ai'), href: '/ai' },
        ]
      : []),
    { label: t('nav.marketplace'), href: '/marketplace' },
    { label: t('nav.rfq'), href: '/rfq' },
    { label: t('nav.pricing'), href: '/pricing' },
  ];

  return (
    <nav
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        isTransparent
          ? 'bg-transparent'
          : 'bg-white/95 backdrop-blur-md border-b border-border shadow-sm'
      }`}
    >
      <div className="container">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group" data-testid="brand-home-nav">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center shadow-sm">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className={`font-bold text-xl tracking-tight ${isTransparent ? 'text-white' : 'text-foreground'}`}>
              BuildHub
            </span>
          </Link>

          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isTransparent
                    ? 'text-white/80 hover:text-white hover:bg-white/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <LanguageToggle className={isTransparent ? 'text-white/80 hover:text-white hover:bg-white/10' : ''} />

            {isAuthenticated && user ? (
              <>
                {/* Notifications.
                    aria-label because this button's only content is an icon and
                    a count badge. A screen reader announced it as "button", and
                    the unread number without a noun means nothing. */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={lang === 'ar' ? 'الرسائل والإشعارات' : 'Messages and notifications'}
                  className={`relative ${isTransparent ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`}
                  onClick={() => navigate('/messages')}
                >
                  <Bell className="w-4 h-4" />
                  {(notifData?.count ?? 0) > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                      {notifData!.count > 9 ? '9+' : notifData!.count}
                    </span>
                  )}
                </Button>

                {/* User Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className={`gap-2 ${isTransparent ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`}>
                      <Avatar className="w-7 h-7">
                        <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                          {user.name?.charAt(0)?.toUpperCase() ?? 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden sm:flex items-center gap-1.5 text-sm font-medium">
                        {user.name?.split(' ')[0]}
                        {planLabel && (
                          <>
                            <span className="opacity-40" aria-hidden="true">·</span>
                            <span className="opacity-80" data-testid="account-plan">{planLabel}</span>
                          </>
                        )}
                      </span>
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  {/* ACCOUNT functions. Dashboard and AI moved to the bar above:
                      they are where the work happens, not settings. */}
                  <DropdownMenuContent align={dir === 'rtl' ? 'start' : 'end'} className="w-56">
                    <div className="px-2 py-1.5">
                      <p className="truncate text-sm font-medium">{user.name ?? user.email}</p>
                      {planLabel && (
                        <p className="mt-0.5 text-xs text-muted-foreground" data-testid="account-plan-menu">
                          {t('billing.currentPlan')}: {planLabel}
                        </p>
                      )}
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/settings')} data-testid="account-settings">
                      {t('dash.settings')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/settings#settings-billing')} data-testid="account-billing">
                      {t('billing.title')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={logout} className="text-destructive">
                      {t('nav.logout')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <div className="hidden md:flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/auth?mode=login')}
                  className={isTransparent ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}
                >
                  {t('nav.signin')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => navigate('/auth?mode=signup')}
                  className={isTransparent ? 'bg-white text-primary hover:bg-white/90' : ''}
                >
                  {t('nav.signup')}
                </Button>
              </div>
            )}

            {/* Mobile menu toggle. Icon-only, and the ONE control that reveals
                navigation on a phone - unnamed, it was unusable with a screen
                reader on the viewport where it is the only way to navigate. */}
            <Button
              variant="ghost"
              size="icon"
              aria-label={mobileOpen
                ? (lang === 'ar' ? 'إغلاق القائمة' : 'Close menu')
                : (lang === 'ar' ? 'فتح القائمة' : 'Open menu')}
              aria-expanded={mobileOpen}
              className={`md:hidden ${isTransparent ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-b border-border shadow-lg">
          <div className="container py-4 flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <LanguageToggle className="w-full justify-start px-4 py-2.5" />
            {!isAuthenticated && (
              <div className="flex gap-2 mt-2 pt-2 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate('/auth?mode=login')}>
                  {t('nav.signin')}
                </Button>
                <Button size="sm" className="flex-1" onClick={() => { navigate('/auth?mode=signup'); setMobileOpen(false); }}
>
                  {t('nav.signup')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

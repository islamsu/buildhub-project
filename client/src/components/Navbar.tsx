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
import { Menu, X, Bell, ChevronDown, Bookmark } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { getRolePlatformPath } from '@/lib/rolePlatform';
import { RakizaLogo } from '@/components/brand/RakizaLogo';

export default function Navbar() {
  const { lang, t, dir } = useLanguage();
  const { user, isAuthenticated, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const [location, navigate] = useLocation();

  const { data: notifData } = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  /** The shortlist badge. Counted server-side; hidden at zero. */
  const { data: savedData } = trpc.profile.savedCount.useQuery(undefined, {
    enabled: isAuthenticated, retry: false,
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

  /*
   * ESCAPE CLOSES THE DRAWER, AND FOCUS COMES BACK.
   *
   * On a phone the drawer is the only way to navigate, and it could be opened
   * and then only closed by hitting the same icon again - there was no
   * keyboard way out, and a keyboard user who tabbed into it had no way to
   * return to where they were. §62 asks for a keyboard-only path through
   * critical flows, and navigation is the most critical one there is.
   */
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMobileOpen(false);
      mobileToggleRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

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
  /*
   * TWO AUDIENCES, TWO BARS.
   *
   * The approved design shows a category-first bar - straight to the kind of
   * thing a buyer came for - and it shows it to a SIGNED-OUT visitor, next to
   * Sign In and Sign Up. That is who it is for: somebody browsing, who should
   * not have to learn what a "Marketplace" hub is before seeing products.
   *
   * A signed-in person is working, not browsing, so Dashboard and the
   * assistant take those slots and discovery collapses back to the hub.
   * Showing both sets at once is how a bar reaches nine items and stops being
   * navigation.
   *
   * EVERY LABEL HERE HAS A DESTINATION THAT EXISTS. The reference bar also
   * names Contractors, Professionals and Projects. There is no contractors
   * directory, no professionals directory, and `/projects/:id` is membership-
   * gated with no public listing - so those are not in this list. A nav item
   * that leads nowhere is worse than one that is missing (§47).
   */
  const discoveryLinks = [
    { label: t('nav.products'), href: '/marketplace/products' },
    { label: t('nav.vendors'), href: '/marketplace/vendors' },
    { label: t('nav.designers'), href: '/marketplace/designers' },
    { label: t('nav.finishing'), href: '/marketplace/finishing' },
  ];

  const navLinks = [
    { label: t('nav.home'), href: '/' },
    ...(isAuthenticated
      ? [
          { label: t('nav.dashboard'), href: getDashboardPath() },
          { label: t('dash.ai'), href: '/ai' },
          { label: t('nav.marketplace'), href: '/marketplace' },
        ]
      : discoveryLinks),
    { label: t('nav.rfq'), href: '/rfq' },
    { label: t('nav.pricing'), href: '/pricing' },
  ];

  /**
   * WHICH ITEM IS THE CURRENT PAGE.
   *
   * There was no active state at all: every item looked identical on every
   * route, so the bar never answered "where am I" - the first question §50
   * says a page must answer.
   *
   * Home matches exactly; everything else matches its subtree, so
   * /marketplace/products/42 still lights Products.
   */
  const isActive = (href: string) =>
    href === '/' ? location === '/' : location === href || location.startsWith(`${href}/`);

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
          {/* THE LOCK-UP, not assembled here. `tone` is the only thing this
              surface decides: the navbar sits over the dark homepage hero and
              over white internal pages, and the mark has to stay visible in
              both - which was previously handled for the wordmark only, so the
              icon tile kept its gradient against the hero it was sitting on. */}
          <Link href="/" className="flex items-center gap-2 group" data-testid="brand-home-nav">
            <RakizaLogo tone={isTransparent ? 'inverse' : 'default'} size="md" />
          </Link>

          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  /*
                   * THREE SIGNALS, NOT ONE. The reference marks the current
                   * item with an amber underline and nothing else. Amber on
                   * white is 2.15:1, which fails the 3:1 floor for a non-text
                   * indicator, and a colour alone is not an acceptable way to
                   * carry state (§56, §62). So the rule is the same underline
                   * PLUS a weight change PLUS aria-current - one for the eye,
                   * one for a reader who cannot resolve the hue, one for a
                   * screen reader.
                   */
                  aria-current={active ? 'page' : undefined}
                  className={`relative px-3 py-2 rounded-lg text-sm transition-colors ${
                    active ? 'font-semibold' : 'font-medium'
                  } ${
                    isTransparent
                      ? active ? 'text-white' : 'text-white/80 hover:text-white hover:bg-white/10'
                      : active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  data-testid={`nav-link-${link.href}`}
                >
                  {link.label}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-brand-accent-500"
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <LanguageToggle className={isTransparent ? 'text-white/80 hover:text-white hover:bg-white/10' : ''} />

            {isAuthenticated && user ? (
              <>
                {/*
                  THE SHORTLIST, WHERE SAVING HAPPENS.

                  Placed in the navbar rather than in one role's workspace
                  menu because ANY signed-in account can save: a contractor
                  sourcing materials is a buyer, and a capability reachable
                  only from the homeowner menu would be one a contractor
                  could use and never find (§47).

                  The count is hidden at zero rather than rendered as "0" -
                  an empty shortlist is not something to badge.
                */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={lang === 'ar' ? 'قائمتي المختصرة' : 'Saved'}
                  className={`relative ${isTransparent ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`}
                  onClick={() => navigate('/saved')}
                  data-testid="navbar-saved"
                >
                  <Bookmark className="w-4 h-4" />
                  {(savedData?.total ?? 0) > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                      {savedData!.total > 9 ? '9+' : savedData!.total}
                    </span>
                  )}
                </Button>
                {/* Notifications.
                    aria-label because this button's only content is an icon and
                    a count badge. A screen reader announced it as "button", and
                    the unread number without a noun means nothing. */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={lang === 'ar' ? 'الرسائل والإشعارات' : 'Messages and notifications'}
                  className={`relative ${isTransparent ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`}
                  /* The badge on this button counts NOTIFICATIONS, so this
                     is where it has to land. Without the tab a reader with
                     one unread notification arrived on the conversations tab
                     and was told there were none. */
                  onClick={() => navigate('/messages?tab=notifications')}
                  data-testid="navbar-notifications"
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
                {/* Outlined, as the reference has it: a secondary action that
                    is still clearly a control rather than a link. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/auth?mode=login')}
                  className={isTransparent ? 'border-white/40 text-white hover:bg-white/10 hover:text-white' : ''}
                  data-testid="nav-signin"
                >
                  {t('nav.signin')}
                </Button>
                {/* THE ONE AMBER CONTROL IN THE BAR. The accent variant owns
                    the treatment, including the dark label the contrast floor
                    requires - see components/ui/button.tsx. It stays amber
                    over the hero too: it is the primary action on the page,
                    and the previous white-on-transparent treatment made it a
                    peer of Sign In. */}
                <Button
                  variant="accent"
                  size="sm"
                  onClick={() => navigate('/auth?mode=signup')}
                  data-testid="nav-signup"
                >
                  {t('nav.signup')}
                </Button>
              </div>
            )}

            {/* Mobile menu toggle. Icon-only, and the ONE control that reveals
                navigation on a phone - unnamed, it was unusable with a screen
                reader on the viewport where it is the only way to navigate. */}
            <Button
              ref={mobileToggleRef}
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
            {navLinks.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  /* The drawer gets the same three signals as the bar. A
                     left border rather than an underline, because a stacked
                     list reads its state at the start of the row. */
                  className={`px-4 py-2.5 rounded-lg text-sm transition-colors hover:bg-muted ${
                    active
                      ? 'font-semibold text-foreground bg-muted border-s-2 border-brand-accent-500'
                      : 'font-medium text-muted-foreground'
                  }`}
                  onClick={() => setMobileOpen(false)}
                  data-testid={`nav-mobile-link-${link.href}`}
                >
                  {link.label}
                </Link>
              );
            })}
            {/* NO LANGUAGE TOGGLE HERE. The bar's own toggle stays visible at
                every width, including behind the open drawer, so a second
                copy inside the list put the same control on screen twice -
                §71 asks for one pattern per decision, and a duplicated
                control is the smallest version of that defect. */}
            {!isAuthenticated && (
              <div className="flex gap-2 mt-2 pt-2 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1"
                  onClick={() => { navigate('/auth?mode=login'); setMobileOpen(false); }}>
                  {t('nav.signin')}
                </Button>
                {/* The drawer's primary action matches the bar's. It also now
                    CLOSES the drawer - sign-in did not, so on a phone the
                    menu stayed open over the page it had just navigated to. */}
                <Button variant="accent" size="sm" className="flex-1"
                  onClick={() => { navigate('/auth?mode=signup'); setMobileOpen(false); }}>
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

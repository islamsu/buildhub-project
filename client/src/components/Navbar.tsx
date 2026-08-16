import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { startLogin } from '@/const';
import { Button } from '@/components/ui/button';
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
import { Building2, Globe, Menu, X, Bell, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { getRolePlatformPath } from '@/lib/rolePlatform';

export default function Navbar() {
  const { lang, setLang, t, dir } = useLanguage();
  const { user, isAuthenticated, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location, navigate] = useLocation();

  const { data: notifData } = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const isTransparent = location === '/';

  const getDashboardPath = () => getRolePlatformPath((user as any)?.userRole);

  const navLinks = [
    { label: t('nav.home'), href: '/' },
    { label: t('nav.marketplace'), href: '/marketplace' },
    { label: t('nav.rfq'), href: '/rfq' },
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
          <Link href="/" className="flex items-center gap-2 group">
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
            {/* Language Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              className={`gap-1.5 text-sm font-medium ${isTransparent ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`}
            >
              <Globe className="w-4 h-4" />
              {lang === 'en' ? 'العربية' : 'English'}
            </Button>

            {isAuthenticated && user ? (
              <>
                {/* Notifications */}
                <Button
                  variant="ghost"
                  size="icon"
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
                      <span className="hidden sm:block text-sm font-medium">{user.name?.split(' ')[0]}</span>
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align={dir === 'rtl' ? 'start' : 'end'} className="w-48">
                    <DropdownMenuItem onClick={() => navigate(getDashboardPath())}>
                      {t('nav.dashboard')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/ai')}>
                      {t('dash.ai')}
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
                  onClick={() => startLogin()}
                  className={isTransparent ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}
                >
                  {t('nav.signin')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => navigate('/auth')}
                  className={isTransparent ? 'bg-white text-primary hover:bg-white/90' : ''}
                >
                  {t('nav.signup')}
                </Button>
              </div>
            )}

            {/* Mobile menu toggle */}
            <Button
              variant="ghost"
              size="icon"
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
            {!isAuthenticated && (
              <div className="flex gap-2 mt-2 pt-2 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => startLogin()}>
                  {t('nav.signin')}
                </Button>
                <Button size="sm" className="flex-1" onClick={() => { navigate('/auth'); setMobileOpen(false); }}>
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

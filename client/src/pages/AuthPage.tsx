import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { startLogin } from '@/const';
import { useEffect, useRef, useState } from 'react';
import { useLocation, Link } from 'wouter';
import LanguageToggle from '@/components/LanguageToggle';
import { toast } from 'sonner';
import { getRolePlatformPath } from '@/lib/rolePlatform';
import { Building2, Home, HardHat, Layers, Package, UserCog, ChevronRight, ShieldCheck, KeyRound } from 'lucide-react';

type UserRole = 'homeowner' | 'contractor' | 'engineer' | 'architect' | 'supplier' | 'project_manager';
const PROFESSIONAL_ROLES: UserRole[] = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'];

const ROLES: { id: UserRole; icon: React.ComponentType<any>; color: string; bg: string }[] = [
  { id: 'homeowner', icon: Home, color: 'text-blue-600', bg: 'bg-blue-50 hover:bg-blue-100 border-blue-200' },
  { id: 'contractor', icon: HardHat, color: 'text-amber-600', bg: 'bg-amber-50 hover:bg-amber-100 border-amber-200' },
  { id: 'engineer', icon: Layers, color: 'text-green-600', bg: 'bg-green-50 hover:bg-green-100 border-green-200' },
  { id: 'architect', icon: Building2, color: 'text-purple-600', bg: 'bg-purple-50 hover:bg-purple-100 border-purple-200' },
  { id: 'supplier', icon: Package, color: 'text-orange-600', bg: 'bg-orange-50 hover:bg-orange-100 border-orange-200' },
  { id: 'project_manager', icon: UserCog, color: 'text-teal-600', bg: 'bg-teal-50 hover:bg-teal-100 border-teal-200' },
];

export default function AuthPage() {
  const { t, lang, dir } = useLanguage();
  const { user, isAuthenticated, loading } = useAuth();
  const [location, navigate] = useLocation();
  const authMode = new URLSearchParams(window.location.search).get('mode');
  const isDummyMode = authMode === 'dummy';
  const isLoginMode = authMode === 'login';
  const isOAuthMode = authMode === 'oauth';
  // A QA sign-in link lands here as /auth?qaToken=... The token is read once,
  // redeemed, and the query string is stripped from history immediately so it
  // does not sit in the address bar, get bookmarked, or leak through a
  // Referer header on the next navigation. It is single-use server-side
  // regardless - this just avoids leaving a spent credential lying around.
  const qaToken = new URLSearchParams(window.location.search).get('qaToken');
  const qaRedeemed = useRef(false);
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [step, setStep] = useState<'role' | 'details' | 'done'>('role');

  // Slice 3: first-party credentials. `capabilities` decides which doors are
  // shown - OAuth only appears where OAUTH_SERVER_URL is actually configured,
  // and "forgot password" only where email delivery exists. Neither is assumed.
  const utils = trpc.useUtils();
  const { data: capabilities } = trpc.auth.capabilities.useQuery();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [signInIdentifier, setSignInIdentifier] = useState('');
  const [signInPassword, setSignInPassword] = useState('');

  /**
   * Refresh the cached session BEFORE navigating anywhere.
   *
   * `useAuth` reads auth.me out of the React Query cache, which still holds the
   * `null` it fetched when this page loaded as an anonymous visitor. Navigating
   * straight to a protected route let that route's guard see an anonymous user
   * and bounce to `/auth?mode=login` through `window.location.href` - a full
   * page load, which also threw away any refetch already in flight.
   *
   * So a successful sign-up ended on the login screen while holding a perfectly
   * valid session cookie. The account existed and a manual reload landed on the
   * right page, which is exactly what made it look like a login bug rather than
   * a stale-cache one.
   *
   * `logout` already invalidated this query. Sign-in, sign-up and QA-link
   * redemption did not - awaiting it here closes that asymmetry for all three.
   */
  const goAfterAuth = async (userRole?: string | null, onboardingStatus?: string | null) => {
    await utils.auth.me.invalidate();
    if (!userRole) {
      navigate('/');
      return;
    }
    navigate(PROFESSIONAL_ROLES.includes(userRole as UserRole) && onboardingStatus !== 'approved'
      ? '/compliance'
      : getRolePlatformPath(userRole as UserRole));
  };

  const signIn = trpc.auth.signIn.useMutation({
    onSuccess: result => {
      toast.success(t('auth.signedIn'));
      void goAfterAuth(result.userRole, result.onboardingStatus);
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const signUp = trpc.auth.signUp.useMutation({
    onSuccess: result => {
      toast.success(t('auth.signedUp'));
      void goAfterAuth(result.userRole, result.onboardingStatus);
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const checkSignupAvailability = trpc.auth.checkSignupAvailability.useMutation();
  const redeemQaLink = trpc.auth.redeemTestLoginLink.useMutation({
    onSuccess: result => {
      toast.success(lang === 'ar' ? 'تم تسجيل الدخول كحساب اختباري' : 'Signed in as a QA test account');
      void goAfterAuth(result.userRole, result.onboardingStatus);
    },
    // Deliberately generic. The server gives one message for unknown, expired,
    // spent and revoked links; surfacing it verbatim keeps that property.
    onError: (error: { message: string }) => toast.error(error.message),
  });

  useEffect(() => {
    if (!qaToken || qaRedeemed.current) return;
    qaRedeemed.current = true;
    window.history.replaceState({}, '', '/auth');
    redeemQaLink.mutate({ token: qaToken });
  }, [qaToken]);
  const updateRole = trpc.auth.updateRole.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(lang === 'ar' ? 'تم إعداد الملف الشخصي بنجاح!' : 'Profile set up successfully!');
      setStep('done');
      navigate(PROFESSIONAL_ROLES.includes(variables.userRole as UserRole) ? '/compliance' : getRolePlatformPath(variables.userRole));
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('error') === 'account_exists') toast.error(t('auth.account.exists'));
  }, [location, t]);

  useEffect(() => {
    if (!loading && isAuthenticated && user && !isDummyMode && !isLoginMode && !isOAuthMode) {
      const pendingRole = localStorage.getItem('pending_role') as UserRole | null;
      const pendingUsername = localStorage.getItem('pending_username') || undefined;
      if (pendingRole) {
        localStorage.removeItem('pending_role');
        localStorage.removeItem('pending_username');
        updateRole.mutate({ userRole: pendingRole, username: pendingUsername });
        return;
      }
      const userRole = (user as any).userRole as UserRole | undefined;
      if (userRole) navigate(PROFESSIONAL_ROLES.includes(userRole) && (user as any).onboardingStatus !== 'approved' ? '/compliance' : getRolePlatformPath(userRole));
    }
  }, [loading, isAuthenticated, user, isDummyMode, isLoginMode, isOAuthMode]);

  useEffect(() => {
    if (step === 'done' && selectedRole) {
      navigate(getRolePlatformPath(selectedRole));
    }
  }, [step, selectedRole]);

  const handleSignUp = () => {
    if (!selectedRole) return;
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,100}$/.test(normalizedUsername)) {
      toast.error(t('auth.username.hint'));
      return;
    }
    if (password.length < 8) {
      toast.error(t('auth.pw.tooShort'));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t('auth.pw.mismatch'));
      return;
    }
    signUp.mutate({
      username: normalizedUsername,
      email: email.trim(),
      password,
      name: name.trim() || normalizedUsername,
      phone: phone.trim() || undefined,
      userRole: selectedRole,
    });
  };

  /**
   * The OAuth signup path, kept for deployments where OAUTH_SERVER_URL still
   * resolves. Unchanged from before Slice 3 - it is now one option rather than
   * the only one.
   */
  const handleOAuthSignUp = () => {
    if (!selectedRole) return;
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,100}$/.test(normalizedUsername)) {
      toast.error(t('auth.username.hint'));
      return;
    }
    checkSignupAvailability.mutate({ username: normalizedUsername }, {
      onSuccess: availability => {
        if (!availability.usernameAvailable || availability.hasExistingAccount) {
          toast.error(t('auth.account.exists'));
          return;
        }
        localStorage.setItem('pending_role', selectedRole);
        localStorage.setItem('pending_username', normalizedUsername);
        startLogin({ type: 'signUp', returnTo: '/auth?mode=signup', username: normalizedUsername });
      },
      onError: error => toast.error(error.message),
    });
  };

  const handleContinue = () => {
    if (!selectedRole) return;
    if (!isAuthenticated) {
      handleSignUp();
      return;
    }
    updateRole.mutate({ userRole: selectedRole, name: name || undefined, phone: phone || undefined, username: username.trim() || undefined });
  };

  const handlePasswordSignIn = () => {
    if (signInIdentifier.trim().length < 3 || !signInPassword) return;
    signIn.mutate({ identifier: signInIdentifier.trim(), password: signInPassword });
  };

  const roleLabels: Record<UserRole, string> = {
    homeowner: t('roles.homeowner'),
    contractor: t('roles.contractor'),
    engineer: t('roles.engineer'),
    architect: t('roles.architect'),
    supplier: t('roles.supplier'),
    project_manager: t('roles.pm'),
  };

  const roleDescs: Record<UserRole, string> = {
    homeowner: t('roles.homeowner.desc'),
    contractor: t('roles.contractor.desc'),
    engineer: t('roles.engineer.desc'),
    architect: t('roles.architect.desc'),
    supplier: t('roles.supplier.desc'),
    project_manager: t('roles.pm.desc'),
  };

  return (
    <div className="min-h-screen bg-background flex" dir={dir}>
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 gradient-hero flex-col justify-between p-12 text-white">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl">BuildHub</span>
        </Link>
        <div>
          <h2 className="text-4xl font-bold leading-tight mb-4">
            {lang === 'ar' ? 'ابنِ مستقبلك\nمع BuildHub' : 'Build Your Future\nwith BuildHub'}
          </h2>
          <p className="text-white/70 text-lg">
            {lang === 'ar'
              ? 'انضم إلى آلاف المحترفين وأصحاب المنازل الذين يثقون في BuildHub لإدارة مشاريع البناء والتشطيب.'
              : 'Join thousands of homeowners and professionals who trust BuildHub to manage their construction and finishing projects.'}
          </p>
        </div>
        <div className="flex gap-8 text-sm text-white/60">
          <div><p className="text-2xl font-bold text-white">10K+</p><p>{lang === 'ar' ? 'مستخدم' : 'Users'}</p></div>
          <div><p className="text-2xl font-bold text-white">5K+</p><p>{lang === 'ar' ? 'مشروع' : 'Projects'}</p></div>
          <div><p className="text-2xl font-bold text-white">2K+</p><p>{lang === 'ar' ? 'مزود' : 'Providers'}</p></div>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-lg">BuildHub</span>
            </Link>
            <LanguageToggle className="ml-auto" />
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-1">{isLoginMode || isOAuthMode ? (lang === 'ar' ? 'تسجيل الدخول' : 'Sign in') : t('auth.signup')}</h1>
            <p className="text-muted-foreground text-sm">{isLoginMode ? (lang === 'ar' ? 'استخدم بيانات المستخدم التجريبي أو اختر تسجيل الدخول للمستخدمين الحقيقيين.' : 'Use test-user credentials or choose real-user sign-in.') : isOAuthMode ? (lang === 'ar' ? 'تسجيل الدخول للمستخدمين الحقيقيين عبر BuildHub.' : 'Sign in as a real user through BuildHub.') : t('auth.role.select')}</p>
            {isAuthenticated && <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"><ShieldCheck className="h-4 w-4" />{lang === 'ar' ? 'تم التحقق من هويتك بأمان عبر تسجيل الدخول الموحد' : 'Your identity is securely verified through BuildHub OAuth'}</div>}
          </div>

          {isLoginMode && (
            <div className="mb-6 space-y-3">
              {/* The primary door since Slice 3. It works on any deployment,
                  with no external identity service reachable. */}
              <form
                className="space-y-2.5"
                onSubmit={event => { event.preventDefault(); handlePasswordSignIn(); }}
              >
                <Input
                  placeholder={t('auth.identifier')} autoComplete="username"
                  value={signInIdentifier} onChange={event => setSignInIdentifier(event.target.value)}
                />
                <Input
                  type="password" placeholder={t('auth.password')} autoComplete="current-password"
                  value={signInPassword} onChange={event => setSignInPassword(event.target.value)}
                />
                <Button
                  type="submit" className="w-full"
                  disabled={signIn.isPending || signInIdentifier.trim().length < 3 || !signInPassword}
                >
                  {signIn.isPending ? t('common.loading') : t('auth.signin')}
                </Button>
              </form>
              {capabilities?.passwordReset && (
                <button
                  type="button"
                  className="w-full text-center text-xs text-primary hover:underline"
                  onClick={() => navigate('/auth/reset-password')}
                >
                  {t('auth.forgot')}
                </button>
              )}
              {capabilities?.oauthSignIn && (
                <Button type="button" variant="outline" className="w-full" onClick={() => navigate('/auth?mode=oauth')}>
                  {t('auth.oauthOption')}
                </Button>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>{t('auth.or.divider')}</span><span className="h-px flex-1 bg-border" /></div>
            </div>
          )}

          {isOAuthMode && (
            <div className="mb-6 space-y-3">
              <Button type="button" className="w-full" onClick={() => startLogin()}>
                {lang === 'ar' ? 'تسجيل الدخول باستخدام BuildHub' : 'Sign in with BuildHub'}
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => navigate('/auth?mode=login')}>
                {lang === 'ar' ? 'العودة إلى تسجيل دخول المستخدم التجريبي' : 'Back to test-user sign in'}
              </Button>
            </div>
          )}

          {!isLoginMode && !isOAuthMode && <>
          {/* Step 1: Role Selection */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {ROLES.map(role => (
              <button
                key={role.id}
                onClick={() => setSelectedRole(role.id)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  selectedRole === role.id
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : `border-border ${role.bg}`
                }`}
              >
                <role.icon className={`w-6 h-6 mb-2 ${selectedRole === role.id ? 'text-primary' : role.color}`} />
                <p className={`text-sm font-semibold ${selectedRole === role.id ? 'text-primary' : 'text-foreground'}`}>
                  {roleLabels[role.id]}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{roleDescs[role.id]}</p>
              </button>
            ))}
          </div>

          {/* Step 2: Details */}
          {selectedRole && (
            <div className="mb-6 space-y-3">
              {!isAuthenticated && <>
                <div>
                  <Input placeholder={t('auth.username')} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
                  <p className="mt-1 text-xs text-muted-foreground">{t('auth.username.hint')}</p>
                </div>
                <Input type="email" placeholder={t('auth.email')} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
                <Input placeholder={t('auth.name')} value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
                <Input placeholder={t('auth.phone')} value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
                <div>
                  <Input type="password" placeholder={t('auth.password')} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                  <p className="mt-1 text-xs text-muted-foreground">{t('auth.pw.tooShort')}</p>
                </div>
                <Input type="password" placeholder={t('auth.pw.confirm')} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
              </>}
              {isAuthenticated && <><Input placeholder={t('auth.name')} value={name} onChange={e => setName(e.target.value)} /><Input placeholder={t('auth.phone')} value={phone} onChange={e => setPhone(e.target.value)} /></>}
            </div>
          )}

          </>}

          {!isLoginMode && !isOAuthMode && <Button
            className="w-full gap-2"
            size="lg"
            disabled={!selectedRole || updateRole.isPending || signUp.isPending
              || (!isAuthenticated && (username.trim().length < 3 || !email.trim() || password.length < 8))}
            onClick={handleContinue}
          >
            {updateRole.isPending || signUp.isPending ? t('common.loading') : isAuthenticated ? t('auth.complete_setup') : t('auth.pw.createAccount')}
            <ChevronRight className="w-4 h-4" />
          </Button>}

          {/* Secondary, and only where the identity service is actually
              configured. Previously this was the only way to create an account. */}
          {!isLoginMode && !isOAuthMode && !isAuthenticated && capabilities?.oauthSignIn && (
            <Button
              variant="outline" className="mt-3 w-full"
              disabled={!selectedRole || checkSignupAvailability.isPending || username.trim().length < 3}
              onClick={handleOAuthSignUp}
            >
              {checkSignupAvailability.isPending ? t('common.loading') : t('auth.oauthOption')}
            </Button>
          )}

          {!isDummyMode && !isLoginMode && !isOAuthMode && (
            <p className="text-center text-sm text-muted-foreground mt-4">
              {t('auth.have.account')}{' '}
              <button onClick={() => navigate('/auth?mode=login')} className="text-primary font-medium hover:underline">
                {t('auth.signin')}
              </button>
            </p>
          )}

          {(isLoginMode || isOAuthMode) && <p className="mb-6 text-center text-sm text-muted-foreground">{lang === 'ar' ? 'ليس لديك حساب؟' : 'New to BuildHub?'}{' '}<button onClick={() => navigate('/auth?mode=signup')} className="font-medium text-primary hover:underline">{lang === 'ar' ? 'إنشاء حساب' : 'Create an account'}</button></p>}

          {/* The public test-user sign-in panel was REMOVED here.
              It advertised a test-login pathway to every visitor - an empty
              username/password form headed "Dummy / Test user sign-in" - on
              the same page real users sign up on.

              The capability itself is NOT deleted. auth.signInDummy still
              exists and is now gated server-side on ENV.testLoginEnabled,
              default-denied, so it answers NOT_FOUND anywhere the flag is not
              explicitly "true". Removing this panel is the cosmetic half; the
              server boundary is the half that matters, and hiding a control
              was never going to be the protection.

              The replacement is admin-issued, expiring, revocable test-login
              links reachable only from the admin area - not a public form. */}
        </div>
      </div>
    </div>
  );
}

import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { startLogin } from '@/const';
import { useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { toast } from 'sonner';
import { getRolePlatformPath } from '@/lib/rolePlatform';
import { Building2, Home, HardHat, Layers, Package, UserCog, ChevronRight, Globe, ShieldCheck } from 'lucide-react';

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
  const { t, lang, setLang, dir } = useLanguage();
  const { user, isAuthenticated, loading } = useAuth();
  const [location, navigate] = useLocation();
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [step, setStep] = useState<'role' | 'details' | 'done'>('role');

  const checkSignupAvailability = trpc.auth.checkSignupAvailability.useMutation();
  const updateRole = trpc.auth.updateRole.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(lang === 'ar' ? 'تم إعداد الملف الشخصي بنجاح!' : 'Profile set up successfully!');
      setStep('done');
      navigate(PROFESSIONAL_ROLES.includes(variables.userRole as UserRole) ? '/compliance' : getRolePlatformPath(variables.userRole));
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  useEffect(() => {
    const query = new URLSearchParams(location.split('?')[1] ?? '');
    if (query.get('error') === 'account_exists') toast.error(t('auth.account.exists'));
  }, [location, t]);

  useEffect(() => {
    if (!loading && isAuthenticated && user) {
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
  }, [loading, isAuthenticated, user]);

  useEffect(() => {
    if (step === 'done' && selectedRole) {
      navigate(getRolePlatformPath(selectedRole));
    }
  }, [step, selectedRole]);

  const handleContinue = () => {
    if (!selectedRole) return;
    if (!isAuthenticated) {
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
      return;
    }
    updateRole.mutate({ userRole: selectedRole, name: name || undefined, phone: phone || undefined, username: username.trim() || undefined });
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
          {/* Mobile logo */}
          <div className="flex items-center justify-between mb-8 lg:hidden">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-lg">BuildHub</span>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} className="gap-1.5">
              <Globe className="w-4 h-4" />
              {lang === 'en' ? 'العربية' : 'English'}
            </Button>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-1">{t('auth.signup')}</h1>
            <p className="text-muted-foreground text-sm">{t('auth.role.select')}</p>
            {isAuthenticated && <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"><ShieldCheck className="h-4 w-4" />{lang === 'ar' ? 'تم التحقق من هويتك بأمان عبر تسجيل الدخول الموحد' : 'Your identity is securely verified through BuildHub OAuth'}</div>}
          </div>

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
              {!isAuthenticated && <div><Input placeholder={t('auth.username')} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /><p className="mt-1 text-xs text-muted-foreground">{t('auth.username.hint')}</p></div>}
              {isAuthenticated && <><Input placeholder={t('auth.name')} value={name} onChange={e => setName(e.target.value)} /><Input placeholder={t('auth.phone')} value={phone} onChange={e => setPhone(e.target.value)} /></>}
            </div>
          )}

          <Button
            className="w-full gap-2"
            size="lg"
            disabled={!selectedRole || updateRole.isPending || checkSignupAvailability.isPending || (!isAuthenticated && username.trim().length < 3)}
            onClick={handleContinue}
          >
            {updateRole.isPending || checkSignupAvailability.isPending ? t('common.loading') : isAuthenticated ? t('auth.complete_setup') : t('auth.continue')}
            <ChevronRight className="w-4 h-4" />
          </Button>

          <p className="text-center text-sm text-muted-foreground mt-4">
            {t('auth.have.account')}{' '}
            <button onClick={() => startLogin()} className="text-primary font-medium hover:underline">
              {t('auth.signin')}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

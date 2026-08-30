// ── /admin/login ───────────────────────────────────────────────────────────
//
// The administrator door, deliberately separate from /auth.
//
// It is not a security boundary by itself - the server decides, and
// auth.adminSignIn refuses anyone who is not an administrator regardless of
// which form they used. What a separate page buys is that the two audiences
// never see each other's door: a customer is never shown an admin login, and an
// administrator is never routed through a page full of role-picker tiles.
//
// Nothing on this page reveals whether an account exists or is an administrator.
// The server returns one identical message for every rejection, and this page
// shows exactly that message rather than interpreting it.

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import LanguageToggle from '@/components/LanguageToggle';

export default function AdminLogin() {
  const { lang, dir } = useLanguage();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const t = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  // Same lesson as the customer sign-in: useAuth reads auth.me from the React
  // Query cache, which still holds the `null` fetched when this page loaded
  // anonymously. Navigating to /admin without refreshing it lets the dashboard's
  // guard see an anonymous user and bounce straight back here.
  const signIn = trpc.auth.adminSignIn.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      toast.success(t('Signed in', 'تم تسجيل الدخول'));
      navigate('/admin');
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });

  useEffect(() => { document.title = 'BuildHub Admin'; }, []);

  const submit = () => {
    if (identifier.trim().length < 3 || !password) return;
    signIn.mutate({ identifier: identifier.trim(), password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4" dir={dir}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" data-testid="brand-home">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold">BuildHub</span>
          </Link>
          <LanguageToggle />
        </div>

        <Card>
          <CardContent className="p-6">
            <h1 className="text-2xl font-bold">{t('Administrator sign-in', 'دخول المشرفين')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('This door is for BuildHub staff. Customer accounts sign in at /auth.',
                 'هذه البوابة لموظفي BuildHub. حسابات العملاء تسجل الدخول من /auth.')}
            </p>

            <form
              className="mt-6 space-y-3"
              onSubmit={event => { event.preventDefault(); submit(); }}
            >
              <Input
                placeholder={t('Username or email', 'اسم المستخدم أو البريد الإلكتروني')}
                autoComplete="username"
                value={identifier}
                onChange={event => setIdentifier(event.target.value)}
              />
              <Input
                type="password"
                placeholder={t('Password', 'كلمة المرور')}
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
              <Button
                type="submit"
                className="w-full gap-2"
                size="lg"
                disabled={signIn.isPending || identifier.trim().length < 3 || !password}
              >
                {signIn.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('Sign in', 'تسجيل الدخول')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {t('Lost access? Another Super Admin can issue you a one-time reset link.',
             'فقدت الوصول؟ يمكن لمشرف عام آخر إصدار رابط إعادة تعيين لمرة واحدة.')}
        </p>
      </div>
    </div>
  );
}

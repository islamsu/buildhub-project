// ── /admin/accept-invitation?token=… ───────────────────────────────────────
//
// Where an invited administrator chooses their own password, and where a
// Super Admin's password-reset link lands. Both are the same object - a
// one-time link that lets this person set a password - so they share a page.
//
// The token is read from the query string and removed from the address bar
// before anything is submitted, so it does not sit in browser history or get
// carried into a Referer header. It is single-use server-side regardless; this
// just avoids leaving a spent credential lying around.

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import LanguageToggle from '@/components/LanguageToggle';

/** Matches ADMIN_PASSWORD_MIN_LENGTH on the server. */
const MIN_LENGTH = 12;

export default function AdminAcceptInvitation() {
  const { lang, dir } = useLanguage();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const tokenRef = useRef<string | null>(null);

  const t = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  if (tokenRef.current === null) {
    tokenRef.current = new URLSearchParams(window.location.search).get('token') ?? '';
  }

  useEffect(() => {
    // Out of the address bar as soon as it is held in memory.
    if (window.location.search.includes('token=')) {
      window.history.replaceState({}, '', '/admin/accept-invitation');
    }
  }, []);

  const redeem = trpc.auth.completeAdminInvitation.useMutation({
    onSuccess: () => {
      toast.success(t('Password set. Please sign in.', 'تم تعيين كلمة المرور. سجّل الدخول الآن.'));
      navigate('/admin/login');
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const token = tokenRef.current ?? '';
  const tooShort = password.length < MIN_LENGTH;
  const mismatch = password !== confirm;

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" dir={dir}>
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <h1 className="text-xl font-bold">{t('No invitation link', 'لا يوجد رابط دعوة')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('This page needs the one-time link you were sent.',
                 'تحتاج هذه الصفحة إلى الرابط الذي أُرسل إليك لمرة واحدة.')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4" dir={dir}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" data-testid="brand-home">
            <KeyRound className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold">BuildHub</span>
          </Link>
          <LanguageToggle />
        </div>
        <Card>
          <CardContent className="p-6">
            <h1 className="text-2xl font-bold">{t('Set your password', 'عيّن كلمة المرور')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Choose a password only you know. Nobody at BuildHub can see it.',
                 'اختر كلمة مرور لا يعرفها سواك. لا يمكن لأحد في BuildHub الاطلاع عليها.')}
            </p>
            <form
              className="mt-6 space-y-3"
              onSubmit={event => { event.preventDefault(); if (!tooShort && !mismatch) redeem.mutate({ token, password }); }}
            >
              <Input
                type="password" autoComplete="new-password"
                placeholder={t('New password', 'كلمة المرور الجديدة')}
                value={password} onChange={event => setPassword(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t(`At least ${MIN_LENGTH} characters.`, `${MIN_LENGTH} أحرف على الأقل.`)}
              </p>
              <Input
                type="password" autoComplete="new-password"
                placeholder={t('Confirm password', 'تأكيد كلمة المرور')}
                value={confirm} onChange={event => setConfirm(event.target.value)}
              />
              {confirm.length > 0 && mismatch && (
                <p className="text-xs text-destructive">{t('Passwords do not match.', 'كلمتا المرور غير متطابقتين.')}</p>
              )}
              <Button type="submit" className="w-full gap-2" size="lg" disabled={redeem.isPending || tooShort || mismatch}>
                {redeem.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('Set password', 'تعيين كلمة المرور')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

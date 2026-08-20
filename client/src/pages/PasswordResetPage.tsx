import { useState } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import LanguageToggle from '@/components/LanguageToggle';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, MailCheck } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Password reset, both halves of it.
 *
 * `/auth/reset-password` with no token asks for an email address; with a token
 * (the link from the email) it sets the new password. One page because they are
 * one flow, and splitting them would duplicate the whole shell.
 *
 * The request half is deliberately vague on success - "if an account exists" -
 * because the server answers identically for a known and an unknown address,
 * and a confident "sent!" here would undo that by implying the address is
 * registered.
 *
 * The request form is not rendered at all when the server reports password
 * reset unavailable (no mail provider or no APP_BASE_URL configured). Showing a
 * button whose only possible outcome is an error is worse than saying so.
 */
export default function PasswordResetPage() {
  const { t, dir } = useLanguage();
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [requested, setRequested] = useState(false);
  const [done, setDone] = useState(false);

  const { data: capabilities } = trpc.auth.capabilities.useQuery();

  const requestReset = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setRequested(true),
    onError: error => toast.error(error.message),
  });

  const resetPassword = trpc.auth.resetPassword.useMutation({
    onSuccess: () => setDone(true),
    onError: error => toast.error(error.message),
  });

  const submitRequest = (event: React.FormEvent) => {
    event.preventDefault();
    requestReset.mutate({ email: email.trim() });
  };

  const submitReset = (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      toast.error(t('auth.pw.mismatch'));
      return;
    }
    if (password.length < 8) {
      toast.error(t('auth.pw.tooShort'));
      return;
    }
    resetPassword.mutate({ token, password });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4" dir={dir}>
      <div className="fixed end-4 top-4 z-10">
        <LanguageToggle />
      </div>
      <Card className="w-full max-w-md min-w-0">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">{t('auth.pw.resetTitle')}</CardTitle>
          {!done && !requested && (
            <CardDescription>{token ? t('auth.pw.chooseNew') : t('auth.pw.resetIntro')}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-600" />
              <p className="text-sm text-muted-foreground">{t('auth.pw.resetDone')}</p>
              <Button className="mt-6 w-full" onClick={() => navigate('/auth?mode=login')}>
                {t('auth.pw.resetDoneCta')}
              </Button>
            </div>
          ) : requested ? (
            <div className="py-6 text-center">
              <MailCheck className="mx-auto mb-3 h-12 w-12 text-primary" />
              <p className="text-sm text-muted-foreground">{t('auth.pw.resetSent')}</p>
              <Button variant="outline" className="mt-6 w-full" onClick={() => navigate('/auth?mode=login')}>
                {t('auth.pw.back')}
              </Button>
            </div>
          ) : token ? (
            <form onSubmit={submitReset} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="reset-password">
                  {t('auth.pw.newPassword')}
                </label>
                <Input
                  id="reset-password" type="password" required autoComplete="new-password"
                  placeholder="••••••••" value={password} onChange={event => setPassword(event.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">{t('auth.pw.tooShort')}</p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="reset-confirm">
                  {t('auth.pw.confirm')}
                </label>
                <Input
                  id="reset-confirm" type="password" required autoComplete="new-password"
                  placeholder="••••••••" value={confirm} onChange={event => setConfirm(event.target.value)}
                />
              </div>
              <Button type="submit" className="w-full gap-2" disabled={resetPassword.isPending}>
                {resetPassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('auth.pw.resetSubmit')}
              </Button>
            </form>
          ) : capabilities && !capabilities.passwordReset ? (
            <div className="py-6 text-center">
              <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-amber-500" />
              <p className="text-sm text-muted-foreground">{t('auth.pw.resetUnavailable')}</p>
              <Button variant="outline" className="mt-6 w-full" onClick={() => navigate('/auth?mode=login')}>
                {t('auth.pw.back')}
              </Button>
            </div>
          ) : (
            <form onSubmit={submitRequest} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="reset-email">
                  {t('auth.email')}
                </label>
                <Input
                  id="reset-email" type="email" required autoComplete="email"
                  value={email} onChange={event => setEmail(event.target.value)}
                />
              </div>
              <Button type="submit" className="w-full gap-2" disabled={requestReset.isPending || !email.trim()}>
                {requestReset.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('auth.pw.resetSend')}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => navigate('/auth?mode=login')}>
                {t('auth.pw.back')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

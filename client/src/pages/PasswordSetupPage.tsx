import { useState } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import LanguageToggle from '@/components/LanguageToggle';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Lock, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function PasswordSetupPage() {
  const { lang, dir } = useLanguage();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);
  const [username, setUsername] = useState('');

  const completeInvitation = trpc.admin.completeInvitation.useMutation({
    onSuccess: data => {
      setSuccess(true);
      setUsername(data.username ?? '');
      toast.success(lang === 'ar' ? 'تم تعيين كلمة المرور بنجاح' : 'Password set successfully');
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      toast.error(lang === 'ar' ? 'كلمات المرور غير متطابقة' : 'Passwords do not match');
      return;
    }
    if (password.length < 6) {
      toast.error(lang === 'ar' ? 'كلمة المرور يجب ألا تقل عن 6 أحرف' : 'Password must be at least 6 characters');
      return;
    }
    completeInvitation.mutate({ token, password });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4" dir={dir}>
      <div className="fixed right-4 top-4 z-10 rtl:left-4 rtl:right-auto">
        <LanguageToggle />
      </div>
      <Card className="w-full max-w-md min-w-0">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">{lang === 'ar' ? 'إعداد كلمة المرور للحساب' : 'Set Account Password'}</CardTitle>
          <CardDescription>
            {lang === 'ar' ? 'أنشئ كلمة مرور جديدة لحسابك المنشأ بواسطة المشرف' : 'Create a password for your admin-created BuildHub account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-600" />
              <h3 className="text-lg font-semibold">{lang === 'ar' ? 'تم تفعيل الحساب بنجاح!' : 'Account Activated Successfully!'}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {lang === 'ar' ? `اسم المستخدم الخاص بك هو @${username}` : `Your username is @${username}`}
              </p>
              <Button className="mt-6 w-full" onClick={() => navigate('/auth')}>
                {lang === 'ar' ? 'الانتقال إلى تسجبل الدخول' : 'Proceed to Sign In'}
              </Button>
            </div>
          ) : !token ? (
            <div className="py-6 text-center">
              <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-rose-500" />
              <p className="text-sm font-medium">{lang === 'ar' ? 'رابط دعوة غير صالح' : 'Invalid invitation link'}</p>
              <Button variant="outline" className="mt-4" onClick={() => navigate('/auth')}>
                {lang === 'ar' ? ' العودة إلى تسجيل الدخول' : 'Back to Sign In'}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{lang === 'ar' ? 'كلمة المرور الجديدة' : 'New Password'}</label>
                <Input type="password" required placeholder="••••••••" value={password} onChange={event => setPassword(event.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{lang === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm Password'}</label>
                <Input type="password" required placeholder="••••••••" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
              </div>
              <Button type="submit" className="w-full gap-2" disabled={completeInvitation.isPending}>
                {completeInvitation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {lang === 'ar' ? 'حفظ كلمة المرور والدخول' : 'Save Password & Sign In'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

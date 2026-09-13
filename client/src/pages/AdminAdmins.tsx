// ── /admin/admins ──────────────────────────────────────────────────────────
//
// Administrator management. Super Admin only - and the server says so too:
// every procedure this page calls is superAdminProcedure. The guard below hides
// controls the server would refuse, which is a courtesy to the user, not the
// protection. Deleting this file would remove no security.
//
// WHAT THIS SCREEN NEVER SHOWS
//
//   a password, a password hash, a session token, a token hash
//
// The invitation link IS shown, exactly once, at the moment it is created:
// it is not stored anywhere (only its sha256 is), so this is the only chance to
// copy it. That is the point of hashing it, not an oversight.

import { useState } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import {
  ShieldCheck, Loader2, UserPlus, Copy, Ban, RotateCcw, KeyRound, LogOut, ArrowLeft, Link2, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { ADMIN_ROLES, ADMIN_ROLE_LABELS, ADMIN_PASSWORD_MIN_LENGTH, type AdminRole } from '@shared/adminRoles';

export default function AdminAdmins() {
  const { lang, dir } = useLanguage();
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const t = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  const { data: me } = trpc.admin.me.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const canManage = me?.permissions.includes('admins.manage') ?? false;

  const { data: admins = [], isLoading } = trpc.admin.admins.useQuery(undefined, { enabled: canManage });

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', username: '', adminRole: 'SUPPORT_ADMIN' as AdminRole });
  // Held in state only so it can be copied; never persisted, never refetched.
  const [issuedLink, setIssuedLink] = useState<string | null>(null);
  /**
   * OUTSTANDING LINKS, AND THE ABILITY TO KILL ONE.
   *
   * `admin.adminInvitations` and `admin.revokeAdminInvitation` existed and
   * worked, and nothing in the client called either. An invitation or reset
   * link that had gone to the wrong address, or to someone who had since left,
   * could not be cancelled from anywhere in the product - the only thing that
   * ended it was its own expiry, hours later. The procedure to revoke it has
   * been there the whole time.
   */
  const [linksFor, setLinksFor] = useState<{ id: number; name: string } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });

  const refresh = () => utils.admin.admins.invalidate();
  const onError = (error: { message: string }) => toast.error(error.message);

  const createAdmin = trpc.admin.createAdmin.useMutation({
    onSuccess: result => {
      setIssuedLink(`${window.location.origin}${result.invitationLink}`);
      setCreating(false);
      setForm({ name: '', email: '', username: '', adminRole: 'SUPPORT_ADMIN' });
      void refresh();
    },
    onError,
  });
  const setRole = trpc.admin.setAdminRole.useMutation({ onSuccess: () => { toast.success(t('Role updated', 'تم تحديث الدور')); void refresh(); }, onError });
  const setActive = trpc.admin.setAdminActive.useMutation({ onSuccess: () => { toast.success(t('Updated', 'تم التحديث')); void refresh(); }, onError });
  const revokeSessions = trpc.admin.revokeAdminSessions.useMutation({ onSuccess: () => toast.success(t('Sessions revoked', 'تم إنهاء الجلسات')), onError });
  const resetPassword = trpc.admin.resetAdminPassword.useMutation({
    onSuccess: result => { setIssuedLink(`${window.location.origin}${result.resetLink}`); void refresh(); },
    onError,
  });

  const { data: invitations = [], isLoading: invitationsLoading, isError: invitationsFailed } =
    trpc.admin.adminInvitations.useQuery(
      { userId: linksFor?.id ?? 0 },
      { enabled: canManage && linksFor !== null },
    );
  const revokeInvitation = trpc.admin.revokeAdminInvitation.useMutation({
    onSuccess: () => {
      toast.success(t('Link revoked', 'تم إبطال الرابط'));
      if (linksFor) void utils.admin.adminInvitations.invalidate({ userId: linksFor.id });
      void refresh();
    },
    onError,
  });

  /**
   * Your OWN password. `admin.changeOwnPassword` was also unreachable, which
   * meant an administrator who suspected their password was known had no way
   * to rotate it - only another Super Admin issuing them a reset link.
   */
  const changeOwnPassword = trpc.admin.changeOwnPassword.useMutation({
    onSuccess: () => {
      toast.success(t('Password changed', 'تم تغيير كلمة المرور'));
      setChangingPassword(false);
      setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' });
    },
    onError,
  });

  /**
   * An invitation's state is DERIVED from its own timestamps, never stored
   * twice: used beats revoked beats expired, and anything else is still live.
   */
  const linkState = (row: { usedAt: Date | string | null; revokedAt: Date | string | null; expiresAt: Date | string }) => {
    if (row.usedAt) return 'used' as const;
    if (row.revokedAt) return 'revoked' as const;
    if (new Date(row.expiresAt).getTime() <= Date.now()) return 'expired' as const;
    return 'live' as const;
  };
  const LINK_LABELS = {
    live: t('Live', 'نشط'),
    used: t('Used', 'مستخدم'),
    revoked: t('Revoked', 'مُبطل'),
    expired: t('Expired', 'منتهٍ'),
  } as const;

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" dir={dir}><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  // Not a Super Admin - including a perfectly valid Sub-Admin who simply lacks
  // this permission. Says so plainly rather than pretending the page is missing.
  if (!canManage) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" dir={dir}>
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h1 className="text-xl font-bold">{t('Super Admin only', 'للمشرف العام فقط')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('Managing administrators requires the Super Admin role.',
                 'إدارة المشرفين تتطلب دور المشرف العام.')}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/admin')}>
              {t('Back to dashboard', 'العودة إلى لوحة التحكم')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const roleLabel = (role: string | null) =>
    role && role in ADMIN_ROLE_LABELS ? ADMIN_ROLE_LABELS[role as AdminRole][lang === 'ar' ? 'ar' : 'en'] : '—';

  return (
    <div className="min-h-screen bg-muted/20 px-4 py-8" dir={dir}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button variant="ghost" size="sm" className="mb-2 gap-1.5" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-4 w-4" />{t('Dashboard', 'لوحة التحكم')}
            </Button>
            <h1 className="text-2xl font-bold">{t('Administrators', 'المشرفون')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('Every administrator has their own account, role and audit trail.',
                 'لكل مشرف حساب ودور وسجل تدقيق خاص به.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" data-testid="admin-change-own-password"
              onClick={() => setChangingPassword(true)}>
              <KeyRound className="h-4 w-4" />{t('Change my password', 'تغيير كلمة مروري')}
            </Button>
            <Button className="gap-2" onClick={() => setCreating(true)}>
              <UserPlus className="h-4 w-4" />{t('Invite administrator', 'دعوة مشرف')}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">{t('Accounts', 'الحسابات')}</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
            ) : admins.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('No administrators yet.', 'لا يوجد مشرفون بعد.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-start text-xs uppercase text-muted-foreground">
                    <tr>
                      {[t('Name', 'الاسم'), t('Username', 'اسم المستخدم'), t('Email', 'البريد'), t('Role', 'الدور'),
                        t('Status', 'الحالة'), t('Created', 'أُنشئ'), t('Last login', 'آخر دخول'), t('Actions', 'إجراءات')]
                        .map(head => <th key={head} className="px-2 py-2 text-start font-medium">{head}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {admins.map(admin => {
                      const self = admin.id === me?.id;
                      const active = admin.accountStatus === 'active';
                      return (
                        <tr key={admin.id} className="border-t">
                          <td className="px-2 py-3 font-medium">{admin.name ?? '—'}{self && <span className="ms-2 text-xs text-muted-foreground">({t('you', 'أنت')})</span>}</td>
                          <td className="px-2 py-3">{admin.username ?? '—'}</td>
                          <td className="px-2 py-3">{admin.email ?? '—'}</td>
                          <td className="px-2 py-3">
                            {self ? (
                              <Badge variant="secondary">{roleLabel(admin.adminRole)}</Badge>
                            ) : (
                              <Select value={admin.adminRole ?? undefined} onValueChange={value => setRole.mutate({ userId: admin.id, adminRole: value as AdminRole })}>
                                <SelectTrigger className="h-8 w-[190px]"><SelectValue placeholder={roleLabel(admin.adminRole)} /></SelectTrigger>
                                <SelectContent>
                                  {ADMIN_ROLES.map(role => (
                                    <SelectItem key={role} value={role}>{ADMIN_ROLE_LABELS[role][lang === 'ar' ? 'ar' : 'en']}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                          <td className="px-2 py-3">
                            <Badge variant={active ? 'default' : 'destructive'}>
                              {active ? t('Active', 'نشط') : t('Deactivated', 'معطل')}
                            </Badge>
                            {!admin.passwordSetAt && (
                              <Badge variant="outline" className="ms-1">{t('Invited', 'مدعو')}</Badge>
                            )}
                          </td>
                          <td className="px-2 py-3 text-muted-foreground">{new Date(admin.createdAt).toLocaleDateString()}</td>
                          <td className="px-2 py-3 text-muted-foreground">{admin.lastSignedIn ? new Date(admin.lastSignedIn).toLocaleDateString() : '—'}</td>
                          <td className="px-2 py-3">
                            {/* No control acts on your own account: the server
                                refuses it, and offering a button that always
                                fails is worse than not offering one. */}
                            <div className="flex flex-wrap gap-1.5">
                              {/* Outstanding links are shown for EVERY row,
                                  your own included: a live link to your own
                                  account is exactly the one you would want to
                                  kill, and no server rule forbids reading it. */}
                              <Button size="sm" variant="ghost" className="gap-1"
                                data-testid={`admin-links-${admin.id}`}
                                onClick={() => setLinksFor({ id: admin.id, name: admin.name ?? admin.username ?? `#${admin.id}` })}>
                                <Link2 className="h-3.5 w-3.5" />{t('Links', 'الروابط')}
                              </Button>
                            </div>
                            {self ? <span className="text-xs text-muted-foreground">—</span> : (
                              <div className="flex flex-wrap gap-1.5">
                                <Button size="sm" variant="outline" className="gap-1" onClick={() => resetPassword.mutate({ userId: admin.id })}>
                                  <KeyRound className="h-3.5 w-3.5" />{t('Reset', 'إعادة تعيين')}
                                </Button>
                                <Button size="sm" variant="outline" className="gap-1" onClick={() => revokeSessions.mutate({ userId: admin.id })}>
                                  <LogOut className="h-3.5 w-3.5" />{t('Revoke sessions', 'إنهاء الجلسات')}
                                </Button>
                                <Button size="sm" variant={active ? 'destructive' : 'default'} className="gap-1"
                                  onClick={() => setActive.mutate({ userId: admin.id, active: !active })}>
                                  {active ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                  {active ? t('Deactivate', 'تعطيل') : t('Reactivate', 'تفعيل')}
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── OUTSTANDING LINKS FOR ONE ADMINISTRATOR ─────────────────────── */}
      <Dialog open={linksFor !== null} onOpenChange={open => !open && setLinksFor(null)}>
        <DialogContent dir={dir} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('Outstanding links', 'الروابط القائمة')}{linksFor ? ` — ${linksFor.name}` : ''}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('Invitation and reset links issued for this account. Only the hash of each link is stored, so none of them can be shown again - but a live one can be revoked.',
               'روابط الدعوة وإعادة التعيين الصادرة لهذا الحساب. يُخزَّن التجزئة فقط لكل رابط، لذا لا يمكن عرض أي منها مرة أخرى - لكن يمكن إبطال الرابط النشط.')}
          </p>
          {invitationsLoading ? (
            <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
          ) : invitationsFailed ? (
            /* An error is NOT an empty list. Saying "no links" when the read
               failed would be a false statement about this account. */
            <p className="py-8 text-center text-sm text-destructive" data-testid="admin-links-error">
              {t('These links could not be loaded. Try again.', 'تعذّر تحميل هذه الروابط. حاول مرة أخرى.')}
            </p>
          ) : invitations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground" data-testid="admin-links-empty">
              {t('No links have been issued for this account.', 'لم تصدر أي روابط لهذا الحساب.')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    {[t('Role', 'الدور'), t('Issued', 'صدر'), t('Expires', 'ينتهي'), t('State', 'الحالة'), t('Action', 'إجراء')]
                      .map(head => <th key={head} className="px-2 py-2 text-start font-medium">{head}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {invitations.map(row => {
                    const state = linkState(row);
                    return (
                      <tr key={row.id} className="border-t" data-testid={`admin-link-${row.id}`} data-state={state}>
                        <td className="px-2 py-3">{roleLabel(row.adminRole)}</td>
                        <td className="px-2 py-3 text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</td>
                        <td className="px-2 py-3 text-muted-foreground">{new Date(row.expiresAt).toLocaleString()}</td>
                        <td className="px-2 py-3">
                          <Badge variant={state === 'live' ? 'default' : state === 'used' ? 'secondary' : 'outline'}>
                            {LINK_LABELS[state]}
                          </Badge>
                        </td>
                        <td className="px-2 py-3">
                          {/* Only a live link can be revoked. A used one is
                              spent and a revoked one is already dead: offering
                              a button that always fails is worse than none. */}
                          {state === 'live' ? (
                            <Button size="sm" variant="destructive" className="gap-1"
                              data-testid={`admin-revoke-link-${row.id}`}
                              disabled={revokeInvitation.isPending}
                              onClick={() => revokeInvitation.mutate({ invitationId: row.id })}>
                              <XCircle className="h-3.5 w-3.5" />{t('Revoke', 'إبطال')}
                            </Button>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── YOUR OWN PASSWORD ────────────────────────────────────────────── */}
      <Dialog open={changingPassword} onOpenChange={open => { setChangingPassword(open); if (!open) setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' }); }}>
        <DialogContent dir={dir}>
          <DialogHeader><DialogTitle>{t('Change my password', 'تغيير كلمة مروري')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="password" autoComplete="current-password" placeholder={t('Current password', 'كلمة المرور الحالية')}
              value={passwordForm.currentPassword} onChange={e => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} />
            <Input type="password" autoComplete="new-password" placeholder={t('New password', 'كلمة المرور الجديدة')}
              value={passwordForm.newPassword} onChange={e => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} />
            <Input type="password" autoComplete="new-password" placeholder={t('Confirm new password', 'تأكيد كلمة المرور الجديدة')}
              value={passwordForm.confirm} onChange={e => setPasswordForm({ ...passwordForm, confirm: e.target.value })} />
            {passwordForm.confirm.length > 0 && passwordForm.newPassword !== passwordForm.confirm && (
              <p className="text-xs text-destructive">{t('The two new passwords do not match.', 'كلمتا المرور الجديدتان غير متطابقتين.')}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t('Your current password is required, so a borrowed session cannot lock you out of your own account.',
                 'كلمة مرورك الحالية مطلوبة، حتى لا تتمكن جلسة مُستعارة من إخراجك من حسابك.')}
            </p>
            <Button className="w-full gap-2" data-testid="admin-submit-own-password"
              disabled={changeOwnPassword.isPending
                || passwordForm.currentPassword.length < 1
                || passwordForm.newPassword.length < ADMIN_PASSWORD_MIN_LENGTH
                || passwordForm.newPassword !== passwordForm.confirm}
              onClick={() => changeOwnPassword.mutate({
                currentPassword: passwordForm.currentPassword,
                newPassword: passwordForm.newPassword,
              })}>
              {changeOwnPassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('Change password', 'تغيير كلمة المرور')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent dir={dir}>
          <DialogHeader><DialogTitle>{t('Invite an administrator', 'دعوة مشرف')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder={t('Full name', 'الاسم الكامل')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <Input placeholder={t('Username', 'اسم المستخدم')} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
            <Input type="email" placeholder={t('Email', 'البريد الإلكتروني')} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <Select value={form.adminRole} onValueChange={value => setForm({ ...form, adminRole: value as AdminRole })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ADMIN_ROLES.map(role => (
                  <SelectItem key={role} value={role}>{ADMIN_ROLE_LABELS[role][lang === 'ar' ? 'ar' : 'en']}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('They receive a one-time link and choose their own password. You will never see it.',
                 'سيحصلون على رابط لمرة واحدة ويختارون كلمة المرور بأنفسهم. لن تطّلع عليها.')}
            </p>
            <Button
              className="w-full gap-2"
              disabled={createAdmin.isPending || form.name.trim().length < 1 || form.username.trim().length < 3 || !form.email.trim()}
              onClick={() => createAdmin.mutate({ ...form, name: form.name.trim(), username: form.username.trim(), email: form.email.trim() })}
            >
              {createAdmin.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('Create and issue link', 'إنشاء وإصدار الرابط')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={issuedLink !== null} onOpenChange={open => !open && setIssuedLink(null)}>
        <DialogContent dir={dir}>
          <DialogHeader><DialogTitle>{t('One-time link', 'رابط لمرة واحدة')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('Copy this now and send it to them over a channel you trust. It is shown once and cannot be retrieved again.',
               'انسخ هذا الآن وأرسله إليهم عبر قناة تثق بها. يُعرض مرة واحدة ولا يمكن استرجاعه.')}
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={issuedLink ?? ''} className="font-mono text-xs" />
            <Button size="icon" variant="outline" onClick={() => {
              void navigator.clipboard.writeText(issuedLink ?? '');
              toast.success(t('Copied', 'تم النسخ'));
            }}><Copy className="h-4 w-4" /></Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('Email delivery is not configured on this deployment, so it is not sent automatically.',
               'إرسال البريد غير مُهيأ في هذا النشر، لذلك لن يُرسل تلقائيًا.')}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
